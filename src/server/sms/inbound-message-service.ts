import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getBusinessProfile } from "@/config/business";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { PhoneNormalizationError, normalizePhone } from "@/lib/phone";

/**
 * Shape of an inbound delivery. Only the fields we rely on are required -
 * providers add fields over time and a stricter schema would start rejecting
 * valid traffic.
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
 * What TextBee actually sends, which is not what the shape above expects.
 *
 * Discovered 2026-08-19 by reading the rejection log: real deliveries were
 * arriving with a valid signature and being turned away as "Unrecognised SMS
 * webhook event", because the event field is `webhookEvent` rather than
 * `event` and the message fields sit at the top level rather than under
 * `data`. Inbound capture had been working the whole time; this code was
 * rejecting it, and the failure looked exactly like a broken handset.
 *
 * Kept as a separate schema rather than loosening the one above, so the
 * documented shape stays documented and the divergence is visible.
 */
export const textBeeFlatMessageSchema = z.object({
  webhookEvent: z.string().optional(),
  smsId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  sender: z.string().min(1),
  message: z.string(),
  receivedAt: z.string().optional(),
});

/**
 * Converts TextBee's flat payload into the shape the rest of the code expects.
 *
 * Returns null when it is not a received-message event, so delivery receipts
 * and anything unrecognised fall through to the caller's own handling.
 */
export function normalizeTextBeePayload(body: unknown): InboundMessagePayload | null {
  const parsed = textBeeFlatMessageSchema.safeParse(body);
  if (!parsed.success) return null;

  const { webhookEvent, smsId, idempotencyKey, sender, message, receivedAt } = parsed.data;

  // Deliberately permissive about the event name. The field arrived as
  // "webhookEvent" with an undocumented value, and a payload carrying both a
  // sender and a message body is a received message whatever it calls itself -
  // being strict here is what caused the original failure.
  if (webhookEvent && /sent|delivered|failed/i.test(webhookEvent)) return null;

  // smsId is the provider's own id and the better idempotency key; the
  // idempotencyKey field is the documented fallback.
  const id = smsId ?? idempotencyKey;
  if (!id) return null;

  return {
    event: "MESSAGE_RECEIVED",
    timestamp: receivedAt ?? new Date().toISOString(),
    data: { _id: id, sender, message, receivedAt },
  };
}

/**
 * Keywords that opt a customer out. Consumer SMS regulations require honouring
 * these, and TextBee - unlike Twilio - does not intercept them at the carrier,
 * so the application must.
 *
 * Deliberately only the unambiguous ones. "cancel" was here and meant that
 * "cancel my appointment" silently opted the customer out of all texts, sent
 * no reply, and left the appointment confirmed with its slot still consumed -
 * the business could no longer contact them and did not know the visit was
 * unwanted. "yes" was in the opt-in set, which suppressed the reply to any
 * message starting with it and re-subscribed someone who had sent STOP.
 */
const OPT_OUT_KEYWORDS = new Set(["stop", "stopall", "unsubscribe", "end", "quit"]);

/** Keywords that opt a customer back in. */
const OPT_IN_KEYWORDS = new Set(["start", "unstop"]);

/**
 * Keywords that must get the fixed HELP reply. Required by CTIA guidelines and
 * promised in the consent disclosure the customer agreed to on the form.
 */
const HELP_KEYWORDS = new Set(["help", "info"]);

/**
 * Compares only the first word, case-insensitively, ignoring punctuation.
 * "STOP" and "Stop." must both count; "please stop by tomorrow" must not.
 */
function classifyKeyword(body: string): "opt-out" | "opt-in" | "help" | null {
  const [firstWord = ""] = body.trim().toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/);

  if (OPT_OUT_KEYWORDS.has(firstWord)) return "opt-out";
  if (OPT_IN_KEYWORDS.has(firstWord)) return "opt-in";
  if (HELP_KEYWORDS.has(firstWord)) return "help";
  return null;
}

export interface InboundResult {
  /** False when this delivery had already been processed. */
  isNew: boolean;
  messageId: string;
  leadId: string | null;
  keyword: "opt-out" | "opt-in" | "help" | null;
  /**
   * True when the message was recognised as our own text coming back, and
   * stored without being answered. Never true against a real customer.
   */
  isEcho?: boolean;
}

/**
 * How far back to look for a matching outbound message.
 *
 * Long enough to cover a slow gateway - TextBee has taken minutes to deliver -
 * and short enough that a customer quoting us hours later is still answered.
 */
const ECHO_WINDOW_MS = 10 * 60 * 1000;

/**
 * Whether this inbound text is one of ours coming back.
 *
 * A handset registered as the gateway can report the messages it just sent as
 * received, because sender and recipient are the same number. Left unguarded
 * the assistant answers itself: reply, echo, reply, echo - booking appointments
 * and spending SMS quota until someone notices.
 *
 * Only reachable while testing with one device. With a real gateway the
 * business number and the customer's are never the same, so this can never fire
 * on a genuine reply - nobody texts back the assistant's own wording verbatim,
 * to the character, within ten minutes.
 */
async function isOurOwnMessageComingBack(phone: string, body: string): Promise<boolean> {
  const echoed = await prisma.message.findFirst({
    where: {
      phone,
      direction: "OUTBOUND",
      body,
      createdAt: { gte: new Date(Date.now() - ECHO_WINDOW_MS) },
    },
    select: { id: true },
  });

  return echoed !== null;
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

  // Before anything else. An echo must not opt the customer out, must not be
  // classified, and must never reach the conversation.
  const isEcho = await isOurOwnMessageComingBack(phone, message);

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

      // An echo is stored so the loop is visible in the transcript, but it
      // changes nothing and gets no reply. Our own booking confirmation ends
      // with "Reply STOP to opt out" - classified as a keyword, that would opt
      // the customer out of their own confirmation.
      if (isEcho) {
        logger.warn("Ignoring our own message reported back as inbound", {
          phone,
          providerMessageId,
        });

        return {
          isNew: true,
          messageId: stored.id,
          leadId: lead?.id ?? null,
          keyword: null,
          isEcho: true,
        };
      }

    // HELP changes no consent state - it is a request for information, and
    // answering it is handled by the caller.
    if (keyword === "opt-out" || keyword === "opt-in") {
      // Applied to the number, not to one lead row. Lead.phone is indexed but
      // not unique - a customer who submitted the form twice has several rows -
      // and consent belongs to the person, not to whichever row happens to be
      // newest. Updating only that row left the older ones with a null
      // smsOptedOutAt, which the intro-SMS retry queue then treats as fair
      // game and texts a number that sent STOP.
      const affected = await prisma.lead.updateMany({
        where: { phone },
        data: { smsOptedOutAt: keyword === "opt-out" ? new Date() : null },
      });

      logger.info(`Number ${keyword === "opt-out" ? "opted out of" : "opted back into"} SMS`, {
        leadId: lead?.id ?? null,
        leadsUpdated: affected.count,
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
