import type { Lead } from "@prisma/client";
import {
  getBusinessProfile,
  getMessageTemplates,
  isAfterHoursReplyEnabled,
} from "@/config/business";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { detectEmergency } from "@/server/sms/emergency-detection";
import { renderTemplate } from "@/server/sms/sms-templates";
import { sendConversationSms } from "@/server/sms/sms-service";
import { generateQualificationReply } from "./ai-service";
import { isWithinBusinessHours } from "./business-hours";

/** What the system decided to do with an inbound message. */
export type ReplyKind = "emergency" | "after-hours" | "ai" | "none";

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

  // --- 2. After hours -----------------------------------------------------
  if (!isWithinBusinessHours() && isAfterHoursReplyEnabled()) {
    const reply = renderBusinessTemplate(templates.afterHours);
    await sendConversationSms(lead, reply);

    logger.info("After-hours reply sent", { leadId: lead.id });
    return { kind: "after-hours", reply, escalated: false };
  }

  // --- 3. Qualification ---------------------------------------------------
  const history = await prisma.message.findMany({
    where: { leadId: lead.id },
    orderBy: { createdAt: "asc" },
  });

  const { reply, provider, model } = await generateQualificationReply(history);

  await sendConversationSms(lead, reply);

  // ENGAGED once the customer has replied and been answered. Qualification
  // proper - issue, urgency, property type - is judged in a later phase, so
  // the lifecycle deliberately stops short of QUALIFIED here.
  if (lead.status === "NEW" || lead.status === "CONTACTED") {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: "ENGAGED" },
    });
  }

  logger.info("Qualification reply sent", { leadId: lead.id, provider, model });

  return { kind: "ai", reply, escalated: false };
}
