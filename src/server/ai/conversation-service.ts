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
import { detectEmergency } from "@/server/sms/emergency-detection";
import { renderTemplate } from "@/server/sms/sms-templates";
import { sendConversationSms } from "@/server/sms/sms-service";
import { generateQualificationReply } from "./ai-service";
import { isWithinBusinessHours } from "./business-hours";

/** What the system decided to do with an inbound message. */
export type ReplyKind = "emergency" | "after-hours" | "slots-offered" | "booked" | "ai" | "none";

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
 *   3. After hours - a fixed, honest holding message rather than an assistant
 *      implying someone is available.
 *   4. Otherwise, qualification by the model.
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

    await sendConversationSms(lead, reply);

    return { kind: "emergency", reply, escalated: true };
  }

  // --- 2. Booking ---------------------------------------------------------
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
    const chosen = matchSlotChoice(inboundBody, offeredSlots);

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

  // --- 3. After hours -----------------------------------------------------
  if (!isWithinBusinessHours() && isAfterHoursReplyEnabled()) {
    const reply = renderBusinessTemplate(templates.afterHours);
    await sendConversationSms(lead, reply);

    logger.info("After-hours reply sent", { leadId: lead.id });
    return { kind: "after-hours", reply, escalated: false };
  }

  // --- 4. Qualification ---------------------------------------------------
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
