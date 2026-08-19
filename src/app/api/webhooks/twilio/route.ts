import { getEnv } from "@/config/env";
import { errorResponse } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { checkRateLimit, pruneRateLimitWindows, rateLimitKey } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { isValidTwilioSignature } from "@/lib/twilio-signature";
import { handleCustomerReply } from "@/server/ai/conversation-service";
import { handleInboundMessage } from "@/server/sms/inbound-message-service";
import { sendHelpReply } from "@/server/sms/sms-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inbound SMS from Twilio.
 *
 * Its own route because Twilio differs from the other gateways in both shape
 * and authentication: form-encoded rather than JSON, and signed over the URL
 * plus sorted parameters rather than the raw body.
 *
 * Replies with empty TwiML. Twilio treats the response body as instructions -
 * returning anything else would make it send a second message on top of the one
 * this app sends itself.
 */

/** An empty TwiML document: "received, say nothing further". */
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twiml(): Response {
  return new Response(EMPTY_TWIML, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

export async function POST(request: Request): Promise<Response> {
  let env: ReturnType<typeof getEnv>;
  try {
    env = getEnv();
  } catch (error) {
    logger.error("Refusing request: environment is not valid", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(503, "INTERNAL_ERROR", "Service is not correctly configured.");
  }

  if (!env.TWILIO_AUTH_TOKEN || !env.TWILIO_WEBHOOK_URL) {
    // Fail closed. The auth token is the signing key, and the URL is part of
    // what is signed, so without both nothing can be verified.
    logger.error("Twilio webhook is not configured: TWILIO_AUTH_TOKEN or TWILIO_WEBHOOK_URL missing");
    return errorResponse(503, "INTERNAL_ERROR", "Webhook receiver is not configured.");
  }

  pruneRateLimitWindows();
  const limit = checkRateLimit(
    rateLimitKey("twilio-webhook"),
    env.SMS_WEBHOOK_RATE_LIMIT,
    env.RATE_LIMIT_WINDOW_MS,
  );

  if (!limit.allowed) {
    logger.warn("Twilio webhook rate limited");
    const response = errorResponse(429, "RATE_LIMITED", "Too many requests.");
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }

  // Form-encoded, not JSON. Read as text first so the exact parameters can be
  // reconstructed for the signature.
  let params: Record<string, string>;
  try {
    const raw = await request.text();
    params = Object.fromEntries(new URLSearchParams(raw));
  } catch {
    return errorResponse(400, "VALIDATION_FAILED", "Body could not be read.");
  }

  if (
    !isValidTwilioSignature(
      env.TWILIO_WEBHOOK_URL,
      params,
      request.headers.get("x-twilio-signature"),
      env.TWILIO_AUTH_TOKEN,
    )
  ) {
    logger.warn("Twilio webhook rejected: bad signature");
    return errorResponse(401, "UNAUTHORIZED", "Invalid signature.");
  }

  const from = params.From;
  const body = params.Body;
  const messageSid = params.MessageSid ?? params.SmsSid;

  if (!from || body === undefined || !messageSid) {
    logger.warn("Twilio webhook missing required fields", { fields: Object.keys(params) });
    return errorResponse(400, "VALIDATION_FAILED", "Payload is not a message event.");
  }

  try {
    const result = await handleInboundMessage({
      event: "MESSAGE_RECEIVED",
      timestamp: new Date().toISOString(),
      data: {
        _id: messageSid,
        sender: from,
        message: body,
        receivedAt: new Date().toISOString(),
      },
    });

    // Same ordering as the other receivers. HELP is answered from a template
    // regardless of opt-out; only a genuinely new message from a known lead
    // reaches the conversation; an echo never does.
    if (result.isNew && !result.isEcho && result.leadId && result.keyword === "help") {
      const lead = await prisma.lead.findUnique({ where: { id: result.leadId } });
      if (lead) {
        try {
          await sendHelpReply(lead);
        } catch (error) {
          logger.error("Failed to send HELP reply", {
            leadId: lead.id,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    if (result.isNew && !result.isEcho && result.leadId && result.keyword === null) {
      const lead = await prisma.lead.findUnique({ where: { id: result.leadId } });
      if (lead) {
        try {
          await handleCustomerReply(lead, body);
        } catch (error) {
          // The message is stored. Failing the webhook now would make Twilio
          // redeliver something already recorded.
          logger.error("Failed to generate or send a reply", {
            leadId: lead.id,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return twiml();
  } catch (error) {
    logger.error("Twilio inbound handling failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(500, "INTERNAL_ERROR", "Could not process the message.");
  }
}
