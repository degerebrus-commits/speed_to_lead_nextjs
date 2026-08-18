import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { getEnv } from "@/config/env";
import { errorResponse } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { checkRateLimit, pruneRateLimitWindows, rateLimitKey } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { handleCustomerReply } from "@/server/ai/conversation-service";
import { handleInboundMessage } from "@/server/sms/inbound-message-service";
import { sendHelpReply } from "@/server/sms/sms-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inbound webhook for SMS Gate (capcom6/android-sms-gateway).
 *
 * Separate from the TextBee receiver because the two authenticate completely
 * differently. TextBee signs an HMAC over the raw body; SMS Gate does not sign
 * at all - its documentation says security rests on the receiving endpoint
 * having a valid certificate, which proves nobody read the message in transit
 * but says nothing about who sent it.
 *
 * So the secret is in the path. Anyone who does not have it gets a 404, and
 * without that guard anyone who learned the URL could forge a customer reply
 * and drive a real booking.
 */

/**
 * The documented event shape. Only sms:received carries a customer message;
 * the delivery events are recorded and acknowledged.
 */
const smsGateEventSchema = z.object({
  event: z.string().min(1),
  payload: z
    .object({
      messageId: z.string().min(1).optional(),
      phoneNumber: z.string().min(1).optional(),
      message: z.string().max(2000).optional(),
      receivedAt: z.string().optional(),
      simNumber: z.number().nullable().optional(),
    })
    .optional(),
  // Some builds put the fields at the top level rather than under payload.
  messageId: z.string().min(1).optional(),
  phoneNumber: z.string().min(1).optional(),
  message: z.string().max(2000).optional(),
  receivedAt: z.string().optional(),
});

/** Delivery events. Recorded, not replied to. */
const DELIVERY_EVENTS = new Set(["sms:sent", "sms:delivered", "sms:failed", "sms:cancelled"]);

function isValidSecret(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ secret: string }> },
): Promise<Response> {
  let env: ReturnType<typeof getEnv>;
  try {
    env = getEnv();
  } catch (error) {
    logger.error("Refusing request: environment is not valid", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(503, "INTERNAL_ERROR", "Service is not correctly configured.");
  }

  if (!env.SMS_GATE_WEBHOOK_SECRET) {
    // Fail closed. An unguarded receiver is worse than none.
    logger.error("SMS Gate webhook is not configured: SMS_GATE_WEBHOOK_SECRET missing");
    return errorResponse(503, "INTERNAL_ERROR", "Webhook receiver is not configured.");
  }

  // Limited before the secret check, so an attacker cannot drive unlimited
  // comparisons against it.
  pruneRateLimitWindows();
  const limit = checkRateLimit(
    rateLimitKey("sms-gate-webhook"),
    env.SMS_WEBHOOK_RATE_LIMIT,
    env.RATE_LIMIT_WINDOW_MS,
  );

  if (!limit.allowed) {
    logger.warn("SMS Gate webhook rate limited");
    const response = errorResponse(429, "RATE_LIMITED", "Too many requests.");
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }

  const { secret } = await params;

  if (!isValidSecret(secret, env.SMS_GATE_WEBHOOK_SECRET)) {
    // 404 rather than 401: a wrong secret should not confirm the endpoint is
    // there to be guessed at.
    logger.warn("SMS Gate webhook rejected: bad path secret");
    return errorResponse(404, "VALIDATION_FAILED", "Not found.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "VALIDATION_FAILED", "Body must be valid JSON.");
  }

  const parsed = smsGateEventSchema.safeParse(body);
  if (!parsed.success) {
    logger.warn("SMS Gate webhook failed validation", {
      fields: parsed.error.issues.map((issue) => issue.path.join(".")),
    });
    return errorResponse(400, "VALIDATION_FAILED", "Payload is not a recognised event.");
  }

  const event = parsed.data.event;
  const p = parsed.data.payload ?? {};
  const messageId = p.messageId ?? parsed.data.messageId;
  const phoneNumber = p.phoneNumber ?? parsed.data.phoneNumber;
  const message = p.message ?? parsed.data.message;
  const receivedAt = p.receivedAt ?? parsed.data.receivedAt;

  // Delivery state is the whole reason this gateway is worth having: TextBee
  // reported "dispatched" and three messages that never left the handset looked
  // exactly like three that arrived.
  if (DELIVERY_EVENTS.has(event)) {
    if (event === "sms:failed") {
      logger.error("SMS Gate reports a message FAILED to send", { event, messageId });
    } else {
      logger.info("SMS Gate delivery event", { event, messageId });
    }

    return Response.json({ received: true, event }, { status: 200 });
  }

  if (event !== "sms:received") {
    logger.info("SMS Gate event acknowledged without action", { event });
    return Response.json({ received: true, event, handled: false }, { status: 200 });
  }

  if (!messageId || !phoneNumber || message === undefined) {
    return errorResponse(400, "VALIDATION_FAILED", "Received event is missing required fields.");
  }

  try {
    const result = await handleInboundMessage({
      event: "MESSAGE_RECEIVED",
      timestamp: new Date().toISOString(),
      data: {
        _id: messageId,
        sender: phoneNumber,
        message,
        receivedAt: receivedAt ?? new Date().toISOString(),
      },
    });

    let replyKind = "none";

    // Same ordering as the TextBee receiver: HELP is answered from a template
    // regardless of opt-out, and only a genuinely new message from a known lead
    // reaches the conversation.
    if (result.isNew && result.leadId && result.keyword === "help") {
      const lead = await prisma.lead.findUnique({ where: { id: result.leadId } });
      if (lead) {
        try {
          await sendHelpReply(lead);
          replyKind = "help";
        } catch (error) {
          logger.error("Failed to send HELP reply", {
            leadId: lead.id,
            reason: error instanceof Error ? error.message : String(error),
          });
          replyKind = "failed";
        }
      }
    }

    if (result.isNew && result.leadId && result.keyword === null) {
      const lead = await prisma.lead.findUnique({ where: { id: result.leadId } });
      if (lead) {
        try {
          const outcome = await handleCustomerReply(lead, message);
          replyKind = outcome.kind;
        } catch (error) {
          // The inbound message is stored. Failing now would make the gateway
          // redeliver something we already have.
          logger.error("Failed to generate or send a reply", {
            leadId: lead.id,
            reason: error instanceof Error ? error.message : String(error),
          });
          replyKind = "failed";
        }
      }
    }

    return Response.json(
      {
        received: true,
        duplicate: !result.isNew,
        leadId: result.leadId,
        keyword: result.keyword,
        reply: replyKind,
      },
      { status: 200 },
    );
  } catch (error) {
    logger.error("SMS Gate inbound handling failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(500, "INTERNAL_ERROR", "Could not process the message.");
  }
}
