import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/config/env";
import { errorResponse, type FieldIssue } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { PhoneNormalizationError } from "@/lib/phone";
import { checkRateLimit, pruneRateLimitWindows } from "@/lib/rate-limit";
import { leadWebhookSchema } from "@/lib/validation/lead-schema";
import { createLead } from "@/server/leads/lead-service";
import { sendIntroSms } from "@/server/sms/sms-service";

// Prisma needs the Node.js runtime; the Edge runtime cannot open a TCP
// connection to Postgres.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const [first] = forwarded.split(",");
    if (first?.trim()) return first.trim();
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Constant-time comparison. A plain === leaks the secret one character at a
 * time to an attacker who can measure response latency.
 */
function isValidSecret(provided: string | null, expected: string): boolean {
  if (!provided) return false;

  const providedBytes = Buffer.from(provided, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");

  // timingSafeEqual throws on length mismatch, so that case is handled first.
  // Length is not the secret; content is.
  if (providedBytes.length !== expectedBytes.length) return false;

  return timingSafeEqual(providedBytes, expectedBytes);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Public lead intake. Untrusted input: rate limited, authenticated by shared
 * secret, validated, then stored idempotently (STANDARDS.md 29).
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

  pruneRateLimitWindows();

  const rateLimit = checkRateLimit(ip, env.RATE_LIMIT_MAX_REQUESTS, env.RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    logger.warn("Lead webhook rate limited", { ip });
    const response = errorResponse(429, "RATE_LIMITED", "Too many requests. Please retry shortly.");
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return response;
  }

  if (!isValidSecret(request.headers.get("x-webhook-secret"), env.LEAD_WEBHOOK_SECRET)) {
    // The rejected value is never logged - it may be a near-miss of the real
    // secret (STANDARDS.md 18).
    logger.warn("Lead webhook rejected: invalid webhook secret", { ip });
    return errorResponse(401, "UNAUTHORIZED", "Invalid or missing webhook secret.");
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse(400, "VALIDATION_FAILED", "Request body is not valid JSON.");
  }

  const parsed = leadWebhookSchema.safeParse(payload);
  if (!parsed.success) {
    const fields: FieldIssue[] = parsed.error.issues.map((issue) => ({
      field: issue.path.join(".") || "(body)",
      message: issue.message,
    }));

    // Field names only - the values are a member of the public's personal
    // details (STANDARDS.md 18). Enough to debug an integration, nothing more.
    logger.warn("Lead webhook rejected: validation failed", {
      ip,
      fields: fields.map((issue) => issue.field),
    });

    return errorResponse(400, "VALIDATION_FAILED", "One or more fields are invalid.", fields);
  }

  let result;
  try {
    result = await createLead(parsed.data);
  } catch (error) {
    if (error instanceof PhoneNormalizationError) {
      return errorResponse(400, "VALIDATION_FAILED", "One or more fields are invalid.", [
        { field: "phone", message: error.message },
      ]);
    }

    logger.error("Lead creation failed", { ip, reason: describeError(error) });
    return errorResponse(500, "INTERNAL_ERROR", "The lead could not be stored. Please try again.");
  }

  if (!result.isNew) {
    logger.info("Duplicate lead submission suppressed", { leadId: result.lead.id });
    return Response.json(
      { leadId: result.lead.id, status: result.lead.status, duplicate: true },
      { status: 200 },
    );
  }

  logger.info("Lead created", { leadId: result.lead.id });

  try {
    await sendIntroSms(result.lead);
  } catch (error) {
    // The lead is already committed. Failing the request now would tell the
    // website its submission was lost when it was not - the precise failure
    // this product exists to prevent. introSmsSentAt stays null, which is what
    // the Phase 3 retry job looks for.
    logger.error("Intro SMS failed; lead stored and left for retry", {
      leadId: result.lead.id,
      reason: describeError(error),
    });
  }

  return Response.json(
    { leadId: result.lead.id, status: result.lead.status, duplicate: false },
    { status: 201 },
  );
}

export function GET(): Response {
  return errorResponse(405, "METHOD_NOT_ALLOWED", "This endpoint accepts POST requests only.");
}
