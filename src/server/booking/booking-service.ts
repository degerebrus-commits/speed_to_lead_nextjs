import { Prisma, type Appointment, type Lead } from "@prisma/client";
import { getBookingSettings, getBusinessProfile, getMessageTemplates } from "@/config/business";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { renderTemplate } from "@/server/sms/sms-templates";

/**
 * Booking runs in application code, not through the model.
 *
 * STANDARDS.md 57.5 - never tell a customer an appointment is booked until it
 * actually is - is a guarantee that cannot depend on a model parsing a reply
 * correctly. So the customer is offered numbered slots and answers with a
 * number, and every step from there is deterministic.
 *
 * The AI still runs the conversation around this; it just does not decide
 * whether a booking happened.
 */

/** Words that mean "I want to book", checked on the first word or as a phrase. */
const BOOKING_INTENT_PHRASES = [
  "book",
  "booking",
  "schedule",
  "appointment",
  "come out",
  "send someone",
  "when can you",
];

/**
 * Slot identity for the unique constraint. Fixed-slot mode has no real
 * timestamps, so the label itself is the resource being contended for.
 */
export function buildSlotKey(slotLabel: string): string {
  return slotLabel.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Whether a customer message is asking to book. */
export function hasBookingIntent(messageBody: string): boolean {
  const haystack = normalize(messageBody);
  if (haystack.length === 0) return false;

  return BOOKING_INTENT_PHRASES.some((phrase) => haystack.includes(phrase));
}

/**
 * Which offered slot a reply selects, or null.
 *
 * Accepts the number ("2"), the number in a sentence ("2 please"), or the
 * label itself ("Mon-Fri 11am") - customers do all three. Returns null rather
 * than guessing when the reply is ambiguous, because a wrong guess books the
 * wrong time.
 *
 * `allowNumericChoice` must be false unless this customer was just shown a
 * numbered list. A bare digit is only a choice in reply to one: read
 * unconditionally it turns "it's been broken for 3 days" into a confirmed
 * appointment. A label match carries its own context and is always safe -
 * nobody types "Mon-Fri 11am" by accident.
 */
export function matchSlotChoice(
  messageBody: string,
  offeredSlots: string[],
  allowNumericChoice: boolean,
): string | null {
  const haystack = normalize(messageBody);
  if (haystack.length === 0 || offeredSlots.length === 0) return null;

  if (allowNumericChoice) {
    const numeric = haystack.match(/\b([1-9]\d?)\b/);
    if (numeric) {
      const index = Number.parseInt(numeric[1], 10) - 1;
      if (index >= 0 && index < offeredSlots.length) return offeredSlots[index];
    }
  }

  const labelMatches = offeredSlots.filter((slot) => haystack.includes(normalize(slot)));

  // Exactly one label match is a choice; two means the reply was ambiguous.
  return labelMatches.length === 1 ? labelMatches[0] : null;
}

/** Slots still free, in configured order. */
export async function getAvailableSlots(): Promise<string[]> {
  const { fixedSlots } = getBookingSettings();
  if (fixedSlots.length === 0) return [];

  const taken = await prisma.appointment.findMany({
    where: { status: { in: ["PENDING", "CONFIRMED"] } },
    select: { slotKey: true },
  });

  const takenKeys = new Set(taken.map((appointment) => appointment.slotKey));

  return fixedSlots.filter((slot) => !takenKeys.has(buildSlotKey(slot)));
}

/** The message offering slots, numbered so a reply of "2" is unambiguous. */
export function buildSlotOffer(slots: string[]): string {
  const numbered = slots.map((slot, index) => `${index + 1}) ${slot}`).join(", ");
  return `I can get someone out to you. Which works best - ${numbered}? Just reply with the number.`;
}

export type BookingFailure = "no-slots" | "slot-taken" | "not-configured";

export interface BookingResult {
  appointment: Appointment | null;
  failure: BookingFailure | null;
  /** The confirmation to send, when booking succeeded. */
  confirmation: string | null;
}

/**
 * Books a slot for a lead.
 *
 * Double-booking is prevented by the unique constraint on `slotKey`, not by
 * checking availability first: two customers replying at the same moment would
 * both pass a read-then-write check, and both would be told they had the slot.
 * One of them has to lose at the database instead.
 */
export async function bookSlot(lead: Lead, slotLabel: string): Promise<BookingResult> {
  const { fixedSlots, durationMinutes, mode } = getBookingSettings();

  if (mode !== "fixed") {
    return { appointment: null, failure: "not-configured", confirmation: null };
  }

  if (!fixedSlots.some((slot) => buildSlotKey(slot) === buildSlotKey(slotLabel))) {
    return { appointment: null, failure: "no-slots", confirmation: null };
  }

  try {
    const appointment = await prisma.appointment.create({
      data: {
        leadId: lead.id,
        slotLabel,
        slotKey: buildSlotKey(slotLabel),
        durationMinutes,
      },
    });

    await prisma.lead.update({ where: { id: lead.id }, data: { status: "BOOKED" } });

    const business = getBusinessProfile();
    const confirmation = renderTemplate(getMessageTemplates().bookingConfirmation, {
      firstName: "",
      businessName: business.name,
      repName: business.repName,
      time: slotLabel,
    });

    logger.info("Appointment booked", { leadId: lead.id, appointmentId: appointment.id });

    return { appointment, failure: null, confirmation };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Someone else took it between the offer and the reply.
      logger.info("Slot already taken", { leadId: lead.id });
      return { appointment: null, failure: "slot-taken", confirmation: null };
    }

    throw error;
  }
}
