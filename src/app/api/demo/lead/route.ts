import { errorResponse } from "@/lib/api-error";
import { getEnv } from "@/config/env";
import { logger } from "@/lib/logger";
import { checkRateLimit, pruneRateLimitWindows } from "@/lib/rate-limit";
import { leadWebhookSchema } from "@/lib/validation/lead-schema";
import { createLead } from "@/server/leads/lead-service";
import { SmsSuppressedError, sendIntroSms } from "@/server/sms/sms-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public demo endpoint, for a landing-page form to post to directly from the
 * browser.
 *
 * Deliberately takes no secret. /api/leads/webhook does, and that secret must
 * stay on a server - a form that carries it in client-side JavaScript has
 * published it, which would let anyone create leads and spend the SMS
 * allowance. So the demo gets its own door with different guards:
 *
 *   - off entirely unless DEMO_FORM_ENABLED
 *   - a shared hourly ceiling on how many texts it can trigger
 *   - consent still required before anything sends, exactly as in production
 *
 * It is not a substitute for the authenticated webhook. Real leads must go
 * through that one.
 */

const DEMO_RATE_KEY = "demo-api";

/** Same-origin is the common case; a hosted landing page needs CORS. */
function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  };
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request): Promise<Response> {
  let env;
  try {
    env = getEnv();
  } catch {
    return errorResponse(503, "INTERNAL_ERROR", "The service is not configured.");
  }

  // 404 rather than a "disabled" message: a switched-off endpoint should not
  // confirm that it exists.
  if (env.DEMO_FORM_ENABLED !== "true") {
    return errorResponse(404, "VALIDATION_FAILED", "Not found.");
  }

  pruneRateLimitWindows();

  const limit = checkRateLimit(DEMO_RATE_KEY, env.DEMO_FORM_HOURLY_LIMIT, 60 * 60 * 1000);

  if (!limit.allowed) {
    logger.warn("Demo API rate limited", { retryAfterSeconds: limit.retryAfterSeconds });

    return new Response(
      JSON.stringify({
        error: {
          code: "RATE_LIMITED",
          message: "This demo has reached its limit for now. Please try again later.",
        },
      }),
      {
        status: 429,
        headers: {
          ...corsHeaders(),
          "content-type": "application/json",
          "retry-after": String(limit.retryAfterSeconds),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "VALIDATION_FAILED", "Body must be valid JSON.");
  }

  const parsed = leadWebhookSchema.safeParse(body);

  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: {
          code: "VALIDATION_FAILED",
          message: parsed.error.issues[0]?.message ?? "Please check the form.",
          fields: parsed.error.issues.map((issue) => issue.path.join(".")),
        },
      }),
      { status: 400, headers: { ...corsHeaders(), "content-type": "application/json" } },
    );
  }

  const { lead } = await createLead(parsed.data);

  try {
    await sendIntroSms(lead);
    logger.info("Demo lead texted", { leadId: lead.id });

    return Response.json(
      { status: "sent", message: "Check your phone - the assistant has texted you." },
      { headers: corsHeaders() },
    );
  } catch (error) {
    // A held send is an expected answer, not a failure: the visitor left the
    // consent box unticked, or the month's allowance is gone. 200 with an
    // honest status beats a 500 that says nothing.
    if (error instanceof SmsSuppressedError) {
      logger.info("Demo lead stored but not texted", { leadId: lead.id, reason: error.reason });

      return Response.json(
        {
          status: "held",
          reason: error.reason,
          message:
            error.reason === "no-consent"
              ? "Saved, but nothing was sent - the consent box was not ticked."
              : "Saved, but this demo has used its text allowance.",
        },
        { headers: corsHeaders() },
      );
    }

    logger.error("Demo lead failed to text", {
      leadId: lead.id,
      reason: error instanceof Error ? error.message : String(error),
    });

    return Response.json(
      { status: "held", reason: "send-failed", message: "Saved, but the text could not be sent." },
      { headers: corsHeaders() },
    );
  }
}
