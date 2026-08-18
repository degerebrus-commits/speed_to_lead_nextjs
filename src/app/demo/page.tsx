import { notFound, redirect } from "next/navigation";

import { getBusinessProfile } from "@/config/business";
import { getEnv } from "@/config/env";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { leadWebhookSchema } from "@/lib/validation/lead-schema";
import { createLead } from "@/server/leads/lead-service";
import { SmsSuppressedError, sendIntroSms } from "@/server/sms/sms-service";

export const dynamic = "force-dynamic";

/**
 * A public form for demonstrating the assistant: fill it in, receive the text
 * the system would send a real lead, reply to it and watch it qualify you.
 *
 * Three things make this different from the webhook the client's website posts
 * to, and each is deliberate:
 *
 * 1. It runs as a server action, so LEAD_WEBHOOK_SECRET never reaches the
 *    browser. A form posting to /api/leads/webhook from client-side JavaScript
 *    would have to ship the secret with it, which would make the endpoint
 *    effectively public.
 * 2. It is off unless DEMO_FORM_ENABLED, because it texts whatever number is
 *    typed into it.
 * 3. It is capped per hour across all visitors. The free SMS tier is 50 a
 *    month; a page that can spend that in an afternoon would take the real
 *    client's leads down with it.
 */

const DEMO_RATE_KEY = "demo-form";

interface DemoState {
  status: "idle" | "sent" | "held" | "limited" | "invalid";
  message?: string;
}

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; detail?: string }>;
}) {
  const env = getEnv();

  // 404 rather than a "disabled" notice: an unadvertised page should not
  // confirm it exists.
  if (env.DEMO_FORM_ENABLED !== "true") notFound();

  const params = await searchParams;
  const business = getBusinessProfile();

  const state: DemoState = {
    status: (params.status as DemoState["status"]) ?? "idle",
    message: params.detail,
  };

  async function submit(formData: FormData) {
    "use server";

    const limit = checkRateLimit(
      DEMO_RATE_KEY,
      getEnv().DEMO_FORM_HOURLY_LIMIT,
      60 * 60 * 1000,
    );

    if (!limit.allowed) {
      logger.warn("Demo form rate limited", { retryAfterSeconds: limit.retryAfterSeconds });
      redirect("/demo?status=limited");
    }

    const parsed = leadWebhookSchema.safeParse({
      name: formData.get("name"),
      phone: formData.get("phone"),
      email: formData.get("email") || undefined,
      serviceAddress: formData.get("serviceAddress"),
      message: formData.get("message"),
      smsConsent: formData.get("smsConsent") === "on",
      smsConsentText: String(formData.get("smsConsentText") ?? ""),
    });

    if (!parsed.success) {
      const detail = parsed.error.issues[0]?.message ?? "Please check the form and try again.";
      redirect(`/demo?status=invalid&detail=${encodeURIComponent(detail)}`);
    }

    const { lead } = await createLead(parsed.data);

    let outcome = "sent";
    let detail = "";

    try {
      await sendIntroSms(lead);
      logger.info("Demo lead texted", { leadId: lead.id });
    } catch (error) {
      // A suppressed send is an expected outcome here, not a failure - the
      // visitor left the consent box unticked, or the month's quota is gone.
      outcome = "held";

      if (error instanceof SmsSuppressedError) {
        detail = error.reason;
        logger.info("Demo lead stored but not texted", { leadId: lead.id, reason: error.reason });
      } else {
        detail = "send-failed";
        logger.error("Demo lead failed to text", {
          leadId: lead.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Outside the try: redirect() signals by throwing, so calling it inside
    // would be caught by the handler above and reported as a failed send.
    redirect(`/demo?status=${outcome}${detail ? `&detail=${detail}` : ""}`);
  }

  const consentText =
    `By submitting this form and signing up for texts, you consent to receive text ` +
    `messages from ${business.name} at the number provided, including messages sent ` +
    `by the auto dialer. Consent is not a condition of purchase. Msg & data rates ` +
    `may apply. Msg frequency varies. Unsubscribe at any time by replying STOP, and ` +
    `no further messages will be sent. Reply HELP for help.`;

  return (
    <>
      <h2>Try the assistant</h2>
      <p className="subtitle">
        Fill this in with <strong>your own phone number</strong> and you will get
        the text a new lead receives. Reply to it and the assistant will answer.
      </p>

      {state.status === "sent" ? (
        <div className="notice notice-good" role="status">
          <h3>Text sent. Check your phone.</h3>
          <p>
            Reply to it however you like — describe a problem, ask a question, or
            ask to book. The assistant answers the way it would a real customer.
          </p>
        </div>
      ) : null}

      {state.status === "held" ? (
        <div className="notice notice-warn" role="status">
          <h3>Saved, but nothing was sent.</h3>
          <p>
            {state.message === "no-consent"
              ? "The consent box was not ticked, so no text goes out — that is the rule the real system follows too."
              : state.message === "quota-exhausted"
                ? "This demo has used its text allowance for the month."
                : "The message could not be sent just now."}
          </p>
        </div>
      ) : null}

      {state.status === "limited" ? (
        <div className="notice notice-warn" role="status">
          <h3>Too many demos in the last hour.</h3>
          <p>Try again a little later.</p>
        </div>
      ) : null}

      {state.status === "invalid" ? (
        <div className="notice notice-bad" role="alert">
          <h3>Please check the form.</h3>
          <p>{state.message}</p>
        </div>
      ) : null}

      <form action={submit} className="card" style={{ maxWidth: "560px" }}>
        <input type="hidden" name="smsConsentText" value={consentText} />

        <DemoField label="Your name" name="name" required autoComplete="name" />
        <DemoField
          label="Mobile number"
          name="phone"
          type="tel"
          required
          autoComplete="tel"
          hint="The assistant will text this number."
        />
        <DemoField label="Email (optional)" name="email" type="email" autoComplete="email" />
        <DemoField
          label="Service address"
          name="serviceAddress"
          required
          hint="Anything will do for a demo."
        />

        <label htmlFor="message" className="metric-label">
          What is the problem?
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={3}
          defaultValue="My AC is running but the house is not getting cool."
          style={{
            display: "block",
            width: "100%",
            padding: "9px 11px",
            margin: "6px 0 16px",
            font: "inherit",
            borderRadius: "8px",
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
          }}
        />

        <label
          htmlFor="smsConsent"
          style={{ display: "flex", gap: "10px", alignItems: "flex-start", marginBottom: "16px" }}
        >
          {/* Never defaultChecked: consent has to be an action the person takes. */}
          <input id="smsConsent" name="smsConsent" type="checkbox" style={{ marginTop: "4px" }} />
          <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>{consentText}</span>
        </label>

        <button type="submit" className="button">
          Text me
        </button>
      </form>
    </>
  );
}

function DemoField({
  label,
  name,
  type = "text",
  required,
  autoComplete,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <>
      <label htmlFor={name} className="metric-label">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        style={{
          display: "block",
          width: "100%",
          padding: "9px 11px",
          margin: "6px 0 4px",
          font: "inherit",
          borderRadius: "8px",
          border: "1px solid var(--border)",
          background: "var(--bg)",
          color: "var(--text)",
        }}
      />
      {hint ? (
        <p className="metric-note" style={{ margin: "0 0 14px" }}>
          {hint}
        </p>
      ) : (
        <div style={{ height: "12px" }} />
      )}
    </>
  );
}
