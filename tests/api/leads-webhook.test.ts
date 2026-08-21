import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/leads/webhook/route";
import { getBusinessProfile, getMessageTemplates } from "@/config/business";
import { prisma } from "@/lib/db";
import { buildIntroMessage } from "@/server/sms/sms-templates";
import type { SmsMessage, SmsProvider } from "@/server/sms/sms-provider";
import { setSmsProviderForTesting } from "@/server/sms/sms-service";

const SECRET = process.env.LEAD_WEBHOOK_SECRET as string;

// Derived from configuration rather than written out, so this suite keeps
// passing when a client changes the business name or the message wording.
const BUSINESS = getBusinessProfile();

const VALID_BODY = {
  name: "John Carter",
  phone: "(555) 123-4567",
  email: "john.carter@example.com",
  serviceAddress: "42 Oak Street, Austin, TX 78701",
  message: "My AC is running but the house is not getting cool.",
  // A form that ticks the consent box, which is what makes the intro SMS
  // lawful. Without it nothing sends, so these cases would pass vacuously.
  smsConsent: true,
  smsConsentText:
    "By submitting this form and signing up for texts, you consent to receive text messages...",
};

function buildRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/leads/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-secret": SECRET,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/** Records what the route actually handed the SMS layer. */
function installSpyProvider(): SmsMessage[] {
  const sent: SmsMessage[] = [];

  const spy: SmsProvider = {
    name: "spy",
    async send(message) {
      sent.push(message);
      return { providerMessageId: `spy-${randomUUID()}`, provider: "spy" };
    },
  };

  setSmsProviderForTesting(spy);
  return sent;
}

describe("POST /api/leads/webhook", () => {
  let sent: SmsMessage[];

  beforeEach(() => {
    sent = installSpyProvider();
  });

  it("persists every mandatory PRD field so they can be read back", async () => {
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.duplicate).toBe(false);

    // Read from the database rather than trusting the response body.
    const stored = await prisma.lead.findUniqueOrThrow({ where: { id: body.leadId } });

    expect(stored.name).toBe("John Carter");
    expect(stored.phone).toBe("+15551234567");
    expect(stored.email).toBe("john.carter@example.com");
    expect(stored.serviceAddress).toBe("42 Oak Street, Austin, TX 78701");
    expect(stored.initialMessage).toBe("My AC is running but the house is not getting cool.");
    expect(stored.status).toBe("NEW");
    expect(stored.introSmsSentAt).not.toBeNull();
  });

  it("treats email as optional, storing null when it is absent", async () => {
    const { email: _omitted, ...withoutEmail } = VALID_BODY;

    const response = await POST(buildRequest(withoutEmail));
    expect(response.status).toBe(201);

    const { leadId } = await response.json();
    const stored = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(stored.email).toBeNull();
  });

  it("hands the SMS layer the normalised number and the exact PRD copy", async () => {
    // Without this the trigger could be wired to nothing and every other
    // assertion in this file would still pass.
    await POST(buildRequest(VALID_BODY));

    const expectedBody = buildIntroMessage(
      VALID_BODY.name,
      BUSINESS.name,
      getMessageTemplates().intro,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("+15551234567");
    expect(sent[0].body).toBe(expectedBody);

    // Guards against the greeting being hardcoded somewhere in the send path:
    // the configured business name must actually reach the message, and no
    // unsubstituted placeholder may survive.
    expect(sent[0].body).toContain(BUSINESS.name);
    expect(sent[0].body).not.toMatch(/\{\w+\}/);
  });

  it("rejects a missing service address and writes nothing", async () => {
    const { serviceAddress: _omitted, ...incomplete } = VALID_BODY;

    const response = await POST(buildRequest(incomplete));
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");

    const failedFields = body.error.fields.map((issue: { field: string }) => issue.field);
    expect(failedFields).toContain("serviceAddress");

    expect(await prisma.lead.count()).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("rejects an unusable phone number and writes nothing", async () => {
    const response = await POST(buildRequest({ ...VALID_BODY, phone: "not-a-phone-xx" }));
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(await prisma.lead.count()).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("rejects a bad secret without storing or texting", async () => {
    const response = await POST(buildRequest(VALID_BODY, { "x-webhook-secret": "wrong-secret" }));
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(await prisma.lead.count()).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("rejects a missing secret", async () => {
    const request = new Request("http://localhost/api/leads/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(await prisma.lead.count()).toBe(0);
  });

  it("creates one lead and sends one SMS when the same webhook arrives twice at once", async () => {
    // Fired simultaneously on purpose. Run sequentially, this passes even when
    // the guard is a SELECT that both callers slip past.
    const outcomes = await Promise.allSettled([
      POST(buildRequest(VALID_BODY)),
      POST(buildRequest(VALID_BODY)),
    ]);

    expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(true);

    const responses = outcomes
      .filter((outcome): outcome is PromiseFulfilledResult<Response> => outcome.status === "fulfilled")
      .map((outcome) => outcome.value);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);

    const bodies = await Promise.all(responses.map((response) => response.json()));
    const leadIds = new Set(bodies.map((body) => body.leadId));

    expect(leadIds.size).toBe(1);
    expect(await prisma.lead.count()).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("suppresses a retried delivery arriving after the first has completed", async () => {
    const first = await POST(buildRequest(VALID_BODY));
    const second = await POST(buildRequest(VALID_BODY));

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((await second.json()).duplicate).toBe(true);

    expect(await prisma.lead.count()).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("treats a different message from the same number as a new lead", async () => {
    await POST(buildRequest(VALID_BODY));

    const response = await POST(
      buildRequest({ ...VALID_BODY, message: "Actually the furnace is out too." }),
    );

    expect(response.status).toBe(201);
    expect(await prisma.lead.count()).toBe(2);
    expect(sent).toHaveLength(2);
  });

  it("stores the lead even when the SMS provider fails", async () => {
    setSmsProviderForTesting({
      name: "failing",
      async send() {
        throw new Error("provider unavailable");
      },
    });

    const response = await POST(buildRequest(VALID_BODY));

    // The lead is what matters. Losing it because a provider hiccuped is the
    // exact failure this product exists to prevent.
    expect(response.status).toBe(201);

    const { leadId } = await response.json();
    const stored = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(stored.introSmsSentAt).toBeNull();
  });

  it("rejects a malformed JSON body", async () => {
    const request = new Request("http://localhost/api/leads/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": SECRET },
      body: "this is not json",
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_FAILED");
  });
});
