import { getEnv } from "@/config/env";
import { errorResponse } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { checkRateLimit, pruneRateLimitWindows, rateLimitKey } from "@/lib/rate-limit";
import { isValidWebhookSignature, isWithinFreshnessWindow } from "@/lib/webhook-signature";
import { handleCustomerReply } from "@/server/ai/conversation-service";
import { prisma } from "@/lib/db";
import {
  handleInboundMessage,
  inboundMessageSchema,
} from "@/server/sms/inbound-message-service";
import { sendHelpReply } from "@/server/sms/sms-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Deliveries we accept but take no action on yet. */
const ACKNOWLEDGED_EVENTS = new Set(["MESSAGE_SENT", "MESSAGE_DELIVERED", "MESSAGE_FAILED"]);

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");

  if (forwarded) {
    const hops = forwarded.split(",").map((hop) => hop.trim()).filter(Boolean);

    if (hops.length > 0) {
      // The LAST hop, not the first. A proxy appends the address it saw, so the
      // last entry is the one our own infrastructure wrote; everything before it
      // was supplied by the caller and can say anything. Taking the first entry
      // let anyone rotate the value per request and slip the limit entirely.
      //
      // With no proxy in front, TRUSTED_PROXY stays false and every request
      // shares one bucket: a blunt limit is better than one that can be
      // sidestepped by setting a header.
      return getEnv().TRUSTED_PROXY === "true" ? hops[hops.length - 1] : "untrusted-proxy";
    }
  }

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Receives SMS events from the gateway.
 *
 * Public and untrusted. Verified by HMAC signature over the raw body, checked
 * for freshness, then processed idempotently.
 *
 * Returns 200 for anything successfully handled *including duplicates* - a
 * non-2xx tells the provider to redeliver, and redelivering a message we have
 * already stored achieves nothing but load.
 */
export async function POST(request: Request): Promise<Response> {
  let env: ReturnType<typeof getEnv>;
  try {
    env = getEnv();
  } catch (error) {
    // Misconfiguration, not a caller error. Say so in the logs - an opaque 500
    // sends whoever is debugging this hunting through application code.
    logger.error("Refusing request: environment is not valid", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(503, "INTERNAL_ERROR", "Service is not correctly configured.");
  }

  const ip = getClientIp(request);

  if (!env.TEXTBEE_WEBHOOK_SECRET) {
    // Never accept unverified traffic on a public endpoint. Failing closed is
    // the only safe behaviour when the verifying secret is absent.
    logger.error("Inbound SMS webhook is not configured: TEXTBEE_WEBHOOK_SECRET missing");
    return errorResponse(503, "INTERNAL_ERROR", "Webhook receiver is not configured.");
  }

  pruneRateLimitWindows();
  const rateLimit = checkRateLimit(
    rateLimitKey(`sms-webhook:${ip}`),
    env.SMS_WEBHOOK_RATE_LIMIT,
    env.RATE_LIMIT_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    logger.warn("Inbound SMS webhook rate limited", { ip });
    const response = errorResponse(429, "RATE_LIMITED", "Too many requests.");
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return response;
  }

  // The raw text, not a parsed-and-re-encoded object: the signature is over
  // exactly these bytes.
  const rawBody = await request.text();

  if (!isValidWebhookSignature(rawBody, request.headers.get("x-signature"), env.TEXTBEE_WEBHOOK_SECRET)) {
    logger.warn("Inbound SMS webhook rejected: bad signature", { ip });
    return errorResponse(401, "UNAUTHORIZED", "Invalid signature.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return errorResponse(400, "VALIDATION_FAILED", "Request body is not valid JSON.");
  }

  const eventName =
    typeof payload === "object" && payload !== null && "event" in payload
      ? String((payload as { event: unknown }).event)
      : "UNKNOWN";

  if (ACKNOWLEDGED_EVENTS.has(eventName)) {
    // Delivery receipts. Recorded once outbound messages carry a status
    // column; acknowledged now so the provider stops retrying them.
    logger.info("SMS delivery event received", { event: eventName });
    return Response.json({ received: true, event: eventName }, { status: 200 });
  }

  if (eventName !== "MESSAGE_RECEIVED") {
    // Log the payload's shape - key names only, never values - so an
    // unexpected provider format can be identified without putting a
    // customer's message text into the logs.
    const topLevelKeys =
      typeof payload === "object" && payload !== null ? Object.keys(payload) : [];
    const nestedKeys =
      typeof payload === "object" && payload !== null && "data" in payload &&
      typeof (payload as { data: unknown }).data === "object" &&
      (payload as { data: unknown }).data !== null
        ? Object.keys((payload as { data: object }).data)
        : [];

    logger.warn("Unrecognised SMS webhook event", {
      event: eventName,
      topLevelKeys,
      nestedKeys,
      bodyLength: rawBody.length,
    });

    return Response.json({ received: true, event: eventName, handled: false }, { status: 200 });
  }

  const parsed = inboundMessageSchema.safeParse(payload);
  if (!parsed.success) {
    logger.warn("Inbound SMS webhook failed validation", {
      fields: parsed.error.issues.map((issue) => issue.path.join(".")),
    });
    return errorResponse(400, "VALIDATION_FAILED", "Payload is not a valid message event.");
  }

  const maxDeliveryAgeMs = env.WEBHOOK_MAX_AGE_MINUTES * 60 * 1000;

  if (!isWithinFreshnessWindow(parsed.data.timestamp, maxDeliveryAgeMs)) {
    logger.warn("Inbound SMS webhook rejected: outside freshness window", {
      timestamp: parsed.data.timestamp,
    });
    return errorResponse(400, "VALIDATION_FAILED", "Delivery timestamp is missing or too old.");
  }

  try {
    const result = await handleInboundMessage(parsed.data);

    let replyKind: string = "none";

    // Only a genuinely new message from a known lead earns a reply. A
    // redelivered webhook must not produce a second text, and an opt-out
    // keyword is an instruction rather than a conversation turn.
    // HELP is answered from a template before anything else, and regardless of
    // opt-out state: the disclosure the customer agreed to promises a reply,
    // and someone who has opted out is exactly the person likely to ask how to
    // reach a human. It never reaches the model - a compliance reply is fixed
    // text, not a judgement call.
    if (result.isNew && !result.isEcho && result.leadId && result.keyword === "help") {
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

    // !isEcho closes the loop: a handset registered as the gateway can report
    // our own outbound texts as inbound, and replying to one makes the
    // assistant answer itself until the quota runs out.
    if (result.isNew && !result.isEcho && result.leadId && result.keyword === null) {
      const lead = await prisma.lead.findUnique({ where: { id: result.leadId } });

      if (lead) {
        try {
          const outcome = await handleCustomerReply(lead, parsed.data.data.message);
          replyKind = outcome.kind;
        } catch (error) {
          // The inbound message is already stored. Failing the webhook now
          // would make the gateway redeliver a message we have, so log and
          // acknowledge - the conversation can be resumed by a human.
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
    // A 500 asks the provider to redeliver, which is what we want for a
    // transient database failure.
    logger.error("Failed to process inbound SMS", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(500, "INTERNAL_ERROR", "Could not process the message.");
  }
}

export function GET(): Response {
  return errorResponse(405, "METHOD_NOT_ALLOWED", "This endpoint accepts POST requests only.");
}
