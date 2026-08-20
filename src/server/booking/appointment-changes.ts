import type { Appointment, Lead } from "@prisma/client";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { deleteCalendarEvent } from "@/server/calendar/calendar-service";

/**
 * Cancellation and reschedule, decided in application code.
 *
 * Same reasoning as booking (STANDARDS.md 57.5): whether an appointment still
 * stands is a fact about the database, not a judgement the model is allowed to
 * make. A customer told "that's cancelled" when it is not will not be there
 * when the technician arrives - and neither will the business.
 *
 * Note that "cancel" was previously an SMS opt-out keyword, so "cancel my
 * appointment" unsubscribed the customer from all texts, sent no reply, and
 * left the appointment confirmed with its slot still held. It was removed from
 * that set; this is where it belongs.
 */

export type AppointmentIntent = "cancel" | "reschedule" | null;

const CANCEL_PHRASES = [
  "cancel",
  "call it off",
  "dont come",
  "do not come",
  "no longer need",
  "dont need",
  "do not need",
  "never mind",
  "nevermind",
];

const RESCHEDULE_PHRASES = [
  "reschedule",
  "resched",
  "move it",
  "move my",
  "change my appointment",
  "change the time",
  "different time",
  "another time",
  "different day",
  "another day",
  "push it",
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * What the customer is asking to do with an existing appointment.
 *
 * Reschedule is checked first: "cancel and rebook" is a reschedule, and
 * treating it as a cancellation would drop the customer rather than move them.
 */
export function detectAppointmentIntent(messageBody: string): AppointmentIntent {
  const haystack = normalize(messageBody);
  if (haystack.length === 0) return null;

  if (RESCHEDULE_PHRASES.some((phrase) => haystack.includes(phrase))) return "reschedule";
  if (CANCEL_PHRASES.some((phrase) => haystack.includes(phrase))) return "cancel";

  return null;
}

/** The appointment a change would apply to: the soonest one still standing. */
export async function findActiveAppointment(
  lead: Lead,
  now: Date = new Date(),
): Promise<Appointment | null> {
  return prisma.appointment.findFirst({
    where: {
      leadId: lead.id,
      status: { in: ["PENDING", "CONFIRMED"] },
      // A visit that has already happened cannot be cancelled. Rows with no
      // timestamp predate scheduledAt and are still treated as live.
      OR: [{ scheduledAt: { gte: now } }, { scheduledAt: null }],
    },
    orderBy: { scheduledAt: "asc" },
  });
}

/**
 * Cancels an appointment and frees its slot.
 *
 * Returns null when there is nothing to cancel, so the caller can say so
 * rather than confirming a cancellation that never happened.
 */
export async function cancelAppointment(
  lead: Lead,
  now: Date = new Date(),
): Promise<Appointment | null> {
  const appointment = await findActiveAppointment(lead, now);
  if (appointment === null) return null;

  const cancelled = await prisma.appointment.update({
    where: { id: appointment.id },
    data: { status: "CANCELLED" },
  });

  // The slot is freed by the status change alone: getAvailableSlots only
  // counts PENDING and CONFIRMED, so nothing else has to be undone.
  //
  // The calendar is a different matter. Cancelling here without removing the
  // event left the visit on the technician's calendar: our database said
  // cancelled, the customer had been told it was cancelled, and someone still
  // drove out. A stale event is worse than never having booked, because it
  // costs a journey rather than an opportunity.
  //
  // calendarEventId is cleared only on a confirmed removal, so a failure
  // leaves the id in place and the row remains findable for a retry.
  if (cancelled.calendarEventId) {
    const removed = await deleteCalendarEvent(cancelled.calendarEventId);

    if (removed) {
      await prisma.appointment.update({
        where: { id: cancelled.id },
        data: { calendarEventId: null },
      });
      cancelled.calendarEventId = null;
    } else {
      logger.error("Cancelled appointment is still on the calendar", {
        appointmentId: cancelled.id,
        eventId: cancelled.calendarEventId,
      });
    }
  }

  logger.info("Appointment cancelled", {
    leadId: lead.id,
    appointmentId: cancelled.id,
  });

  return cancelled;
}
