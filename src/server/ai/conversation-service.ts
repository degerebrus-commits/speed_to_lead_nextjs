import type { Lead } from "@prisma/client";
import {
  getBusinessProfile,
  getMessageTemplates,
  isAfterHoursReplyEnabled,
} from "@/config/business";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  bookSlot,
  buildSlotOffer,
  getAvailableSlots,
  hasBookingIntent,
  matchSlotChoice,
} from "@/server/booking/booking-service";
import {
  cancelAppointment,
  detectAppointmentIntent,
  findActiveAppointment,
} from "@/server/booking/appointment-changes";
import { detectEmergency } from "@/server/sms/emergency-detection";
import { renderTemplate } from "@/server/sms/sms-templates";
import { sendConversationSms, sendOwnerEmergencyAlert } from "@/server/sms/sms-service";
import { generateQualificationReply } from "./ai-service";
import { isWithinBusinessHours } from "./business-hours";

/** What the system decided to do with an inbound message. */
export type ReplyKind =
  | "emergency"
  | "after-hours"
  | "slots-offered"
  | "booked"
  | "cancelled"
  | "nothing-to-cancel"
  | "ai"
  | "none";

export interface ConversationOutcome {
  kind: ReplyKind;
  /** The text sent, or null when nothing was sent. */
  reply: string | null;
  /** Set when the conversation was handed to a human. */
  escalated: boolean;
}

function renderBusinessTemplate(template: string): string {
  const business = getBusinessProfile();

  return renderTemplate(template, {
    firstName: "",
    businessName: business.name,
    repName: business.repName,
  });
}

/**
 * Decides and sends the reply to an inbound customer message.
 *
 * Order matters and is not arbitrary:
 *
 *   1. Opted out - never message again, whatever else is true.
 *   2. Emergency - decided by keyword matching in code, so it still works when
 *      the AI provider is down. Short-circuits everything else.
 *   3. Cancel or reschedule - before booking, because "move me to Thursday"
 *      contains a word slot matching would read as a fresh selection.
 *   4. Booking - deterministic, and ahead of after-hours so a customer can
 *      book at 2am rather than receive an apology.
 *   5. After hours - a fixed, honest holding message rather than an assistant
 *      implying someone is available.
 *   6. Otherwise, qualification by the model.
 */
export async function handleCustomerReply(
  lead: Lead,
  inboundBody: string,
): Promise<ConversationOutcome> {
  if (lead.smsOptedOutAt) {
    logger.info("Skipping reply: lead has opted out", { leadId: lead.id });
    return { kind: "none", reply: null, escalated: false };
  }

  const templates = getMessageTemplates();

  // --- 1. Emergency -------------------------------------------------------
  const emergency = detectEmergency(inboundBody);
  if (emergency.isEmergency) {
    const reply = renderBusinessTemplate(templates.emergency);

    // Status changes before the send: if the SMS fails we still want a human
    // looking at this lead, which is the entire point of the escalation.
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: "HUMAN_HANDOFF" },
    });

    logger.warn("Emergency detected - lead escalated", {
      leadId: lead.id,
      matchedKeyword: emergency.matchedKeyword,
      ownerPhoneConfigured: getBusinessProfile().ownerPhone !== null,
    });

    // Alert the owner before answering the customer: if only one message gets
    // out, it should be the one that brings a human. Wrapped because a failure
    // here must not stop the customer's reply - and it is logged loudly,
    // because an emergency nobody was told about is the worst outcome in this
    // system.
    try {
      const alerted = await sendOwnerEmergencyAlert(lead, inboundBody);

      if (!alerted) {
        logger.error("Emergency NOT escalated to a human: OWNER_PHONE is not configured", {
          leadId: lead.id,
        });
      }
    } catch (error) {
      logger.error("Emergency owner alert failed to send", {
        leadId: lead.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    await sendConversationSms(lead, reply);

    return { kind: "emergency", reply, escalated: true };
  }

  // --- 2. Cancel or reschedule --------------------------------------------
  // Ahead of booking on purpose. "cancel" carries no digit, but "move me to
  // Thursday" does, and slot matching would read it as a fresh selection
  // rather than a request to change an existing visit.
  const change = detectAppointmentIntent(inboundBody);

  if (change !== null) {
    const existing = await findActiveAppointment(lead);

    if (existing === null) {
      // Say so rather than confirming a cancellation that never happened.
      const reply = renderBusinessTemplate(templates.nothingToCancel);
      await sendConversationSms(lead, reply);

      logger.info("Change requested with no active appointment", {
        leadId: lead.id,
        intent: change,
      });
      return { kind: "nothing-to-cancel", reply, escalated: false };
    }

    await cancelAppointment(lead);

    if (change === "cancel") {
      const reply = renderBusinessTemplate(templates.cancellation);
      await sendConversationSms(lead, reply);

      await prisma.lead.update({ where: { id: lead.id }, data: { status: "QUALIFIED" } });

      logger.info("Appointment cancelled at customer request", { leadId: lead.id });
      return { kind: "cancelled", reply, escalated: false };
    }

    // Reschedule: the old slot is released first, so it can be re-offered to
    // this customer rather than looking taken by their own booking.
    const remaining = await getAvailableSlots();

    const reply =
      remaining.length > 0
        ? `No problem, I've released that time. ${buildSlotOffer(remaining)}`
        : "No problem, I've released that time. I have nothing else free right now - the team will call you to sort another.";

    await sendConversationSms(lead, reply);

    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: remaining.length > 0 ? "APPOINTMENT_PENDING" : "HUMAN_HANDOFF" },
    });

    logger.info("Appointment released for reschedule", {
      leadId: lead.id,
      slotsOffered: remaining.length,
    });
    return { kind: "slots-offered", reply, escalated: false };
  }

  // --- 3. Booking ---------------------------------------------------------
  // Runs before the model. Whether an appointment exists is a fact about the
  // database, not a judgement the model is allowed to make (STANDARDS.md 2.3,
  // 57.5) - a customer must never be told they are booked when they are not.
  //
  // Deliberately ahead of the after-hours branch. Booking is deterministic and
  // safe at any hour, and "increase after-hours bookings" is one of the
  // product's stated goals - a customer who texts at 2am asking for a slot
  // should get one, not an apology. Only open-ended conversation waits for
  // the morning.
  const offeredSlots = await getAvailableSlots();

  if (offeredSlots.length > 0) {
    // APPOINTMENT_PENDING is set only by the offer branch below, so it is the
    // record of having shown this customer a numbered list. A digit counts as
    // a choice only after that; a slot label still counts at any time.
    //
    // Read from the database rather than the passed-in lead: the offer may have
    // been made on an earlier turn, leaving the caller's copy stale. Trusting
    // that copy would silently re-open the bug this guard exists to close.
    const current = await prisma.lead.findUnique({
      where: { id: lead.id },
      select: { status: true },
    });

    const wasOfferedSlots = current?.status === "APPOINTMENT_PENDING";
    const chosen = matchSlotChoice(inboundBody, offeredSlots, wasOfferedSlots);

    if (chosen) {
      const booking = await bookSlot(lead, chosen);

      if (booking.appointment && booking.confirmation) {
        await sendConversationSms(lead, booking.confirmation);

        await prisma.appointment.update({
          where: { id: booking.appointment.id },
          data: { confirmationSentAt: new Date() },
        });

        logger.info("Booking confirmed to customer", { leadId: lead.id });
        return { kind: "booked", reply: booking.confirmation, escalated: false };
      }

      if (booking.failure === "slot-taken") {
        // Taken between offer and reply. Re-offer what is actually left
        // rather than apologising for a slot that may still be free.
        const remaining = await getAvailableSlots();

        const reply =
          remaining.length > 0
            ? `Sorry, that one just went. ${buildSlotOffer(remaining)}`
            : "Sorry, that one just went and I have nothing else free right now - the team will call you to sort a time.";

        await sendConversationSms(lead, reply);
        return { kind: "slots-offered", reply, escalated: false };
      }
    }

    if (hasBookingIntent(inboundBody)) {
      const reply = buildSlotOffer(offeredSlots);
      await sendConversationSms(lead, reply);

      await prisma.lead.update({
        where: { id: lead.id },
        data: { status: "APPOINTMENT_PENDING" },
      });

      logger.info("Slots offered", { leadId: lead.id, slotCount: offeredSlots.length });
      return { kind: "slots-offered", reply, escalated: false };
    }
  }

  // --- 4. After hours -----------------------------------------------------
  if (!isWithinBusinessHours() && isAfterHoursReplyEnabled()) {
    const reply = renderBusinessTemplate(templates.afterHours);
    await sendConversationSms(lead, reply);

    logger.info("After-hours reply sent", { leadId: lead.id });
    return { kind: "after-hours", reply, escalated: false };
  }

  // --- 5. Qualification ---------------------------------------------------
  const history = await prisma.message.findMany({
    where: { leadId: lead.id },
    orderBy: { createdAt: "asc" },
  });

  const { reply, provider, model } = await generateQualificationReply(history);

  await sendConversationSms(lead, reply);

  // ENGAGED once the customer has replied and been answered. Deliberately does
  // not overwrite APPOINTMENT_PENDING or BOOKED - a later chat message must not
  // walk a lead backwards through its own lifecycle.
  if (lead.status === "NEW" || lead.status === "CONTACTED") {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: "ENGAGED" },
    });
  }

  logger.info("Qualification reply sent", { leadId: lead.id, provider, model });

  return { kind: "ai", reply, escalated: false };
}
