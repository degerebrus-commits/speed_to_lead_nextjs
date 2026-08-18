import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/sms/route";
import { prisma } from "@/lib/db";
import type { SmsMessage, SmsProvider } from "@/server/sms/sms-provider";
import { SmsSuppressedError, sendIntroSms, setSmsProviderForTesting } from "@/server/sms/sms-service";

const SECRET = process.env.TEXTBEE_WEBHOOK_SECRET as string;
const CUSTOMER_PHONE = "+15551234567";

function buildPayload(overrides: Record<string, unknown> = {}) {
  // Top-level overrides are applied before `data` is assembled, so an override
  // of one data field cannot silently replace the whole object.
  const { data: dataOverrides, ...topLevel } = overrides;

  return {
    event: "MESSAGE_RECEIVED",
    timestamp: new Date().toISOString(),
    ...topLevel,
    data: {
      _id: "provider-msg-1",
      sender: CUSTOMER_PHONE,
      message: "My AC stopped working last night",
      receivedAt: new Date().toISOString(),
      ...((dataOverrides as Record<string, unknown>) ?? {}),
    },
  };
}

/** Signs the exact bytes that will be sent, as the gateway does. */
function buildRequest(payload: unknown, signature?: string): Request {
  const rawBody = JSON.stringify(payload);

  return new Request("http://localhost/api/webhooks/sms", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature": signature ?? createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex"),
    },
    body: rawBody,
  });
}

async function seedLead(phone = CUSTOMER_PHONE) {
  return prisma.lead.create({
    data: {
      name: "John Carter",
      phone,
      serviceAddress: "42 Oak Street",
      initialMessage: "My AC is not cooling.",
      dedupeKey: `dedupe-${phone}-${Date.now()}-${Math.random()}`,
    },
  });
}

describe("POST /api/webhooks/sms", () => {
  it("stores an inbound message and links it to the matching lead", async () => {
    const lead = await seedLead();

    const response = await POST(buildRequest(buildPayload()));
    expect(response.status).toBe(200);

    const stored = await prisma.message.findFirstOrThrow({ where: { direction: "INBOUND" } });

    expect(stored.leadId).toBe(lead.id);
    expect(stored.body).toBe("My AC stopped working last night");
    expect(stored.phone).toBe(CUSTOMER_PHONE);
    expect(stored.providerMessageId).toBe("provider-msg-1");
    expect(stored.receivedAt).not.toBeNull();
  });

  it("rejects a forged signature and stores nothing", async () => {
    await seedLead();

    const response = await POST(buildRequest(buildPayload(), "deadbeef"));

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("UNAUTHORIZED");
    expect(await prisma.message.count()).toBe(0);
  });

  it("rejects a body tampered with after signing", async () => {
    await seedLead();

    const original = buildPayload();
    const signature = createHmac("sha256", SECRET)
      .update(JSON.stringify(original), "utf8")
      .digest("hex");

    const tampered = buildPayload({ data: { message: "different text entirely" } });

    const response = await POST(buildRequest(tampered, signature));

    expect(response.status).toBe(401);
    expect(await prisma.message.count()).toBe(0);
  });

  it("processes a redelivered webhook exactly once", async () => {
    await seedLead();
    const payload = buildPayload();

    const first = await POST(buildRequest(payload));
    const second = await POST(buildRequest(payload));

    expect(first.status).toBe(200);
    expect((await first.json()).duplicate).toBe(false);

    // 200, not an error: a non-2xx would tell the gateway to keep retrying.
    expect(second.status).toBe(200);
    expect((await second.json()).duplicate).toBe(true);

    // Inbound specifically: the first delivery legitimately triggers an
    // outbound reply, so a total count would conflate the two.
    expect(await prisma.message.count({ where: { direction: "INBOUND" } })).toBe(1);
  });

  it("handles two simultaneous deliveries of the same message", async () => {
    await seedLead();
    const payload = buildPayload();

    const outcomes = await Promise.allSettled([
      POST(buildRequest(payload)),
      POST(buildRequest(payload)),
    ]);

    expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(true);
    expect(await prisma.message.count({ where: { direction: "INBOUND" } })).toBe(1);
  });

  it("rejects a stale delivery", async () => {
    await seedLead();

    const stale = buildPayload({
      timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });

    const response = await POST(buildRequest(stale));

    expect(response.status).toBe(400);
    expect(await prisma.message.count()).toBe(0);
  });

  it("still stores a message from a number with no matching lead", async () => {
    const response = await POST(buildRequest(buildPayload()));

    expect(response.status).toBe(200);

    // Dropping a real customer's text because no row matched would be worse
    // than keeping an orphan.
    const stored = await prisma.message.findFirstOrThrow();
    expect(stored.leadId).toBeNull();
  });

  it("acknowledges delivery-receipt events without storing a message", async () => {
    const response = await POST(buildRequest({ event: "MESSAGE_DELIVERED", timestamp: new Date().toISOString() }));

    expect(response.status).toBe(200);
    expect(await prisma.message.count()).toBe(0);
  });

  describe("opt-out", () => {
    it("marks the lead opted out when they text STOP", async () => {
      const lead = await seedLead();

      const response = await POST(
        buildRequest(buildPayload({ data: { _id: "stop-1", message: "STOP" } })),
      );

      expect((await response.json()).keyword).toBe("opt-out");

      const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(updated.smsOptedOutAt).not.toBeNull();
    });

    it("recognises lower case and trailing punctuation", async () => {
      const lead = await seedLead();

      await POST(buildRequest(buildPayload({ data: { _id: "stop-2", message: "stop." } })));

      const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(updated.smsOptedOutAt).not.toBeNull();
    });

    it("answers HELP from the route, without involving the model", async () => {
      // The unit test for sendHelpReply passes even if the route never calls
      // it, so this asserts the wiring: HELP in, a fixed reply out.
      const lead = await seedLead();
      await prisma.lead.update({
        where: { id: lead.id },
        data: { smsConsentAt: new Date() },
      });

      const response = await POST(
        buildRequest(buildPayload({ data: { _id: "help-1", message: "HELP" } })),
      );

      expect(response.status).toBe(200);
      expect((await response.json()).reply).toBe("help");

      const outbound = await prisma.message.findMany({
        where: { leadId: lead.id, direction: "OUTBOUND" },
      });
      expect(outbound).toHaveLength(1);
      expect(outbound[0].body).toContain("STOP");
    });

    it("applies the opt-out to every lead sharing that number", async () => {
      // Lead.phone is not unique: a customer who submitted the form twice has
      // several rows. Marking only the newest left the older ones eligible for
      // the intro-SMS retry queue, which then texted a number that sent STOP.
      const base = {
        name: "John Carter",
        phone: CUSTOMER_PHONE,
        serviceAddress: "42 Oak Street",
        initialMessage: "My AC is not cooling.",
      };

      const older = await prisma.lead.create({
        data: { ...base, dedupeKey: "older-submission", introSmsSentAt: null },
      });
      const newer = await prisma.lead.create({
        data: { ...base, dedupeKey: "newer-submission" },
      });

      await POST(
        buildRequest(buildPayload({ data: { _id: "stop-multi", message: "STOP" } })),
      );

      for (const lead of [older, newer]) {
        const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
        expect(updated.smsOptedOutAt, lead.dedupeKey).not.toBeNull();
      }
    });

    it("treats 'cancel my appointment' as a message, not an opt-out", async () => {
      // "cancel" used to be an opt-out keyword, so this silently unsubscribed
      // the customer, sent no reply, and left the appointment confirmed with
      // its slot still consumed.
      const lead = await seedLead();

      const response = await POST(
        buildRequest(
          buildPayload({ data: { _id: "cancel-1", message: "Cancel my appointment please" } }),
        ),
      );

      expect(response.status).toBe(200);
      expect((await response.json()).keyword).toBeNull();

      const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(updated.smsOptedOutAt).toBeNull();
    });

    it("does not treat 'yes' as an opt-in that resubscribes a stopped number", async () => {
      const lead = await prisma.lead.create({
        data: {
          name: "John Carter",
          phone: CUSTOMER_PHONE,
          serviceAddress: "42 Oak Street",
          initialMessage: "My AC is not cooling.",
          dedupeKey: "already-opted-out",
          smsOptedOutAt: new Date(),
        },
      });

      await POST(
        buildRequest(buildPayload({ data: { _id: "yes-1", message: "Yes that works" } })),
      );

      const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(updated.smsOptedOutAt).not.toBeNull();
    });

    it("does not opt out on an ordinary sentence containing the word", async () => {
      const lead = await seedLead();

      const response = await POST(
        buildRequest(
          buildPayload({ data: { _id: "not-stop", message: "Can you stop by tomorrow?" } }),
        ),
      );

      // Assert the request actually succeeded - otherwise this passes for the
      // wrong reason when the payload is malformed and never reaches the
      // classifier.
      expect(response.status).toBe(200);
      expect((await response.json()).keyword).toBeNull();

      const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(updated.smsOptedOutAt).toBeNull();
    });

    it("lets a customer opt back in with START", async () => {
      const lead = await seedLead();

      await POST(buildRequest(buildPayload({ data: { _id: "stop-3", message: "STOP" } })));
      await POST(buildRequest(buildPayload({ data: { _id: "start-1", message: "START" } })));

      const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(updated.smsOptedOutAt).toBeNull();
    });

    it("refuses to text a lead who has opted out", async () => {
      const sent: SmsMessage[] = [];
      const spy: SmsProvider = {
        name: "spy",
        async send(message) {
          sent.push(message);
          return { providerMessageId: "spy-id", provider: "spy" };
        },
      };
      setSmsProviderForTesting(spy);

      const lead = await seedLead();
      await POST(buildRequest(buildPayload({ data: { _id: "stop-4", message: "STOP" } })));

      const optedOut = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });

      await expect(sendIntroSms(optedOut)).rejects.toBeInstanceOf(SmsSuppressedError);

      // The point of the whole feature: nothing reached the gateway.
      expect(sent).toHaveLength(0);
    });
  });
});
