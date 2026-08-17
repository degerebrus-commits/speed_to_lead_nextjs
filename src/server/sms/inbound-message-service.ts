import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getBusinessProfile } from "@/config/business";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { PhoneNormalizationError, normalizePhone } from "@/lib/phone";

/**
 * Shape of a TextBee MESSAGE_RECEIVED delivery. Only the fields we rely on are
 * required - providers add fields over time and a stricter schema would start
 * rejecting valid traffic.
 */
export const inboundMessageSchema = z.object({
  event: z.string(),
  timestamp: z.string().optional(),
  data: z.object({
    _id: z.string().min(1),
    sender: z.string().min(1),
    message: z.string(),
    receivedAt: z.string().optional(),
  }),
});

export type InboundMessagePayload = z.infer<typeof inboundMessageSchema>;

/**
 * Keywords that opt a customer out. Consumer SMS regulations require honouring
 * these, and TextBee - unlike Twilio - does not intercept them at the carrier,
 * so the application must.
 */
const OPT_OUT_KEYWORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);

/** Keywords that opt a customer back in. */
const OPT_IN_KEYWORDS = new Set(["start", "unstop", "yes"]);

/**
 * Compares only the first word, case-insensitively, ignoring punctuation.
 * "STOP" and "Stop." must both count; "please stop by tomorrow" must not.
 */
function classifyKeyword(body: string): "opt-out" | "opt-in" | null {
  const [firstWord = ""] = body.trim().toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/);

  if (OPT_OUT_KEYWORDS.has(firstWord)) return "opt-out";
  if (OPT_IN_KEYWORDS.has(firstWord)) return "opt-in";
  return null;
}

export interface InboundResult {
  /** False when this delivery had already been processed. */
  isNew: boolean;
  messageId: string;
  leadId: string | null;
  keyword: "opt-out" | "opt-in" | null;
}

/**
 * Stores an inbound SMS and applies any opt-out it carries.
 *
 * Idempotent on the provider's message id: a redelivered webhook collides on
 * the unique constraint rather than being processed as a second customer
 * message (STANDARDS.md 28, 57.8).
 */
export async function handleInboundMessage(
  payload: InboundMessagePayload,
): Promise<InboundResult> {
  const { countryCode } = getBusinessProfile();
  const { _id: providerMessageId, sender, message, receivedAt } = payload.data;

  let phone: string;
  try {
    phone = normalizePhone(sender, countryCode);
  } catch (error) {
    if (error instanceof PhoneNormalizationError) {
      // Store it against the raw sender rather than dropping a real message.
      phone = sender.trim();
    } else {
      throw error;
    }
  }

  // Most recent lead for this number. A customer who submitted the form twice
  // has several; their reply belongs to the conversation they just started.
  const lead = await prisma.lead.findFirst({
    where: { phone },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  const keyword = classifyKeyword(message);

  try {
    const stored = await prisma.message.create({
      data: {
        leadId: lead?.id ?? null,
        direction: "INBOUND",
        phone,
        body: message,
        providerMessageId,
        provider: "textbee",
        receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
      },
    });

    if (lead && keyword) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { smsOptedOutAt: keyword === "opt-out" ? new Date() : null },
      });

      logger.info(`Lead ${keyword === "opt-out" ? "opted out of" : "opted back into"} SMS`, {
        leadId: lead.id,
      });
    }

    if (!lead) {
      // Worth surfacing: it means someone is texting a number we have no
      // record of, which is either a stale conversation or a wrong number.
      logger.warn("Inbound SMS from a number with no matching lead", { providerMessageId });
    }

    return { isNew: true, messageId: stored.id, leadId: lead?.id ?? null, keyword };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.message.findUnique({
        where: { providerMessageId },
        select: { id: true, leadId: true },
      });

      if (existing) {
        logger.info("Duplicate inbound webhook suppressed", { providerMessageId });
        return { isNew: false, messageId: existing.id, leadId: existing.leadId, keyword };
      }
    }

    throw error;
  }
}
