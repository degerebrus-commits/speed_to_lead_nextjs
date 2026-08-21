import { getEnv } from "@/config/env";
import { getBusinessProfile, getMessageTemplates } from "@/config/business";
import { prisma } from "@/lib/db";
import { formatSlotForCustomer } from "@/server/booking/slot-schedule";
import { renderTemplate } from "@/server/sms/sms-templates";
import { sendConversationSms, SmsSuppressedError } from "@/server/sms/sms-service";
import { logger } from "@/lib/logger";

/**
 * The reminder before a visit.
 *
 * Exists because the confirmation was the last message a customer ever got.
 * Once booked they had no further chance to say they no longer wanted the
 * visit, so the first anyone heard of it was a technician outside the house.
 *
 * Driven by a scheduler calling the route, not by a timer in this process. A
 * dev server that restarts, or a container that is replaced, would silently
 * drop in-process timers and nobody would notice until reminders stopped.
 */

export interface ReminderRun {
  /** Visits due a reminder in this pass. */
  due: number;
  sent: number;
  failed: number;
  /** Opted out, or otherwise refused before reaching the gateway. */
  skipped: number;
}

/**
 * Sends the reminder for any confirmed visit starting within the window.
 *
 * `reminderSentAt` is stamped whether or not the send succeeds, and that is
 * deliberate. A gateway that is refusing messages will still be refusing them
 * on the next pass, and the alternative - retrying every few minutes until the
 * appointment starts - texts the customer a dozen times the moment it recovers.
 * A missed reminder is a small loss; a burst of them is the business looking
 * broken.
 */
export async function sendDueReminders(now: Date = new Date()): Promise<ReminderRun> {
  const { APPOINTMENT_REMINDER_MINUTES } = getEnv();
  const windowEnd = new Date(now.getTime() + APPOINTMENT_REMINDER_MINUTES * 60 * 1000);

  const due = await prisma.appointment.findMany({
    where: {
      status: { in: ["PENDING", "CONFIRMED"] },
      reminderSentAt: null,
      // Between now and the window edge. The lower bound matters: a visit that
      // already started needs no reminder, and without it every past
      // appointment would be texted the first time this ever ran.
      scheduledAt: { gt: now, lte: windowEnd },
      lead: { smsOptedOutAt: null },
    },
    include: { lead: true },
    orderBy: { scheduledAt: "asc" },
  });

  const run: ReminderRun = { due: due.length, sent: 0, failed: 0, skipped: 0 };
  const { timezone } = getBusinessProfile();
  const business = getBusinessProfile();

  for (const appointment of due) {
    const body = renderTemplate(getMessageTemplates().reminder, {
      firstName: appointment.lead.name.trim().split(/\s+/)[0] || appointment.lead.name,
      businessName: business.name,
      repName: business.repName,
      time: appointment.scheduledAt
        ? formatSlotForCustomer(appointment.scheduledAt, timezone)
        : appointment.slotLabel,
    });

    try {
      await sendConversationSms(appointment.lead, body);
      run.sent += 1;
    } catch (error) {
      if (error instanceof SmsSuppressedError) {
        run.skipped += 1;
        logger.info("Reminder skipped", {
          appointmentId: appointment.id,
          reason: error.reason,
        });
      } else {
        run.failed += 1;
        logger.error("Reminder failed to send", {
          appointmentId: appointment.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { reminderSentAt: new Date() },
    });
  }

  logger.info("Reminder run complete", { ...run });

  return run;
}
