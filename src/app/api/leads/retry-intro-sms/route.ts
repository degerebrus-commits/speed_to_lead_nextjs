import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/config/env";
import { errorResponse } from "@/lib/api-error";
import { checkRateLimit, pruneRateLimitWindows, rateLimitKey } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { countPendingIntroSms, retryPendingIntroSms } from "@/server/leads/intro-sms-retry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Upper bound on what a single call may attempt, whatever the caller asks. */
const MAX_BATCH_LIMIT = 100;

function isValidSecret(provided: string | null, expected: string): boolean {
  if (!provided) return false;

  const providedBytes = Buffer.from(provided, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (providedBytes.length !== expectedBytes.length) return false;

  return timingSafeEqual(providedBytes, expectedBytes);
}

/**
 * Drains the queue of leads that never received an introductory message.
 *
 * Shares the lead-intake secret rather than introducing another credential -
 * it is the same trust boundary, operated by the same people, and one fewer
 * secret to rotate. Intended to be run on a schedule, or by hand after fixing
 * a gateway outage.
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

  // Limited before the secret is checked, not after: this was the only
  // publicly reachable endpoint with no limit at all, so an attacker could
  // drive unlimited constant-time comparisons and unlimited requests at the
  // process without ever holding a valid secret.
  pruneRateLimitWindows();
  const rateLimit = checkRateLimit(
    rateLimitKey("retry-intro-sms"),
    env.RATE_LIMIT_MAX_REQUESTS,
    env.RATE_LIMIT_WINDOW_MS,
  );

  if (!rateLimit.allowed) {
    logger.warn("Retry endpoint rate limited");
    const response = errorResponse(429, "RATE_LIMITED", "Too many requests.");
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return response;
  }

  if (!isValidSecret(request.headers.get("x-webhook-secret"), env.LEAD_WEBHOOK_SECRET)) {
    logger.warn("Retry endpoint rejected: invalid secret");
    return errorResponse(401, "UNAUTHORIZED", "Invalid or missing webhook secret.");
  }

  const requested = Number(new URL(request.url).searchParams.get("limit"));
  const limit =
    Number.isInteger(requested) && requested > 0
      ? Math.min(requested, MAX_BATCH_LIMIT)
      : undefined;

  try {
    const outcome = await retryPendingIntroSms(limit);
    const stillPending = await countPendingIntroSms();

    return Response.json({ ...outcome, stillPending }, { status: 200 });
  } catch (error) {
    logger.error("Intro SMS retry run failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(500, "INTERNAL_ERROR", "The retry run could not complete.");
  }
}

/** Read-only queue depth, so the backlog can be checked without sending. */
export async function GET(request: Request): Promise<Response> {
  // Wrapped like POST's. Unwrapped, a configuration error here surfaced as an
  // unhandled 500 with a stack, rather than the 503 that says what is wrong.
  let env: ReturnType<typeof getEnv>;
  try {
    env = getEnv();
  } catch (error) {
    logger.error("Refusing request: environment is not valid", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(503, "INTERNAL_ERROR", "Service is not correctly configured.");
  }

  if (!isValidSecret(request.headers.get("x-webhook-secret"), env.LEAD_WEBHOOK_SECRET)) {
    return errorResponse(401, "UNAUTHORIZED", "Invalid or missing webhook secret.");
  }

  return Response.json({ pending: await countPendingIntroSms() }, { status: 200 });
}
