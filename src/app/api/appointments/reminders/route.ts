import { timingSafeEqual } from "node:crypto";

import { getEnv } from "@/config/env";
import { errorResponse } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { checkRateLimit, pruneRateLimitWindows, rateLimitKey } from "@/lib/rate-limit";
import { sendDueReminders } from "@/server/booking/appointment-reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidSecret(provided: string | null, expected: string): boolean {
  if (!provided) return false;

  const providedBytes = Buffer.from(provided, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (providedBytes.length !== expectedBytes.length) return false;

  return timingSafeEqual(providedBytes, expectedBytes);
}

/**
 * Sends reminders for visits starting soon.
 *
 * Meant to be called on a schedule - every few minutes is enough, because the
 * work is idempotent: an appointment already reminded is never picked up again.
 * Calling it twice in a row is safe, and calling it late only means a reminder
 * goes out closer to the appointment than intended.
 *
 * Shares the lead-intake secret rather than adding another credential: same
 * trust boundary, same operator, one fewer thing to rotate.
 */
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

  // Limited before the secret check, so an attacker without a valid secret
  // still cannot drive unlimited work at the process.
  pruneRateLimitWindows();
  const rateLimit = checkRateLimit(
    rateLimitKey("appointment-reminders"),
    env.RATE_LIMIT_MAX_REQUESTS,
    env.RATE_LIMIT_WINDOW_MS,
  );

  if (!rateLimit.allowed) {
    logger.warn("Reminder endpoint rate limited");
    const response = errorResponse(429, "RATE_LIMITED", "Too many requests.");
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return response;
  }

  if (!isValidSecret(request.headers.get("x-webhook-secret"), env.LEAD_WEBHOOK_SECRET)) {
    logger.warn("Reminder endpoint rejected: invalid secret");
    return errorResponse(401, "UNAUTHORIZED", "Invalid or missing webhook secret.");
  }

  try {
    const run = await sendDueReminders();
    return Response.json(run, { status: 200 });
  } catch (error) {
    logger.error("Reminder run failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(500, "INTERNAL_ERROR", "The reminder run could not complete.");
  }
}
