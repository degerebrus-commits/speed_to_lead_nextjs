import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetEnvCache } from "@/config/env";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/webhooks/sms-gate/[secret]/route";
import type { SmsMessage, SmsProvider } from "@/server/sms/sms-provider";
import { setSmsProviderForTesting } from "@/server/sms/sms-service";

const SECRET = "sms-gate-path-secret-0123456789ab";

/**
 * Keys this spec sets, restored individually afterwards.
 *
 * Deliberately NOT `process.env = { ...ORIGINAL }`: the suite runs in a single
 * fork, so replacing the object wholesale leaves other files' snapshots holding
 * a stale copy - which is what broke the cancellation specs the first time this
 * file was written, and is already recorded in MISTAKES.md.
 */
const TOUCHED = [
  "SMS_GATE_WEBHOOK_SECRET",
  "BUSINESS_OPEN_DAYS",
  "BUSINESS_OPEN_HOUR",
  "BUSINESS_CLOSE_HOUR",
] as const;
const SAVED: Record<string, string | undefined> = {};
const CUSTOMER = "+15551239876";

function installSpySms(): SmsMessage[] {
  const sent: SmsMessage[] = [];
  setSmsProviderForTesting({
    name: "spy",
    async send(message) {
      sent.push(message);
      return { providerMessageId: `spy-${sent.length}-${Math.random()}`, provider: "spy" };
    },
  } satisfies SmsProvider);
  return sent;
}

let seq = 0;
async function seedLead(overrides: Record<string, unknown> = {}) {
  seq += 1;
  return prisma.lead.create({
    data: {
      name: "John Carter",
      phone: CUSTOMER,
      serviceAddress: "42 Oak Street",
      initialMessage: "My AC is not cooling.",
      dedupeKey: `gate-${seq}-${Date.now()}-${Math.random()}`,
      smsConsentAt: new Date(),
      ...overrides,
    },
  });
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/webhooks/sms-gate/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Next passes route params as a promise. */
const ctx = (secret: string) => ({ params: Promise.resolve({ secret }) });

function received(message: string, id = `gate-${Math.random()}`) {
  return {
    event: "sms:received",
    payload: {
      messageId: id,
      phoneNumber: CUSTOMER,
      message,
      receivedAt: new Date().toISOString(),
    },
  };
}

beforeEach(() => {
  for (const key of TOUCHED) SAVED[key] = process.env[key];

  process.env.SMS_GATE_WEBHOOK_SECRET = SECRET;
  process.env.BUSINESS_OPEN_DAYS = "1,2,3,4,5,6,7";
  process.env.BUSINESS_OPEN_HOUR = "0";
  process.env.BUSINESS_CLOSE_HOUR = "24";
  resetEnvCache();
});

afterEach(() => {
  for (const key of TOUCHED) {
    if (SAVED[key] === undefined) delete process.env[key];
    else process.env[key] = SAVED[key];
  }
  resetEnvCache();
});

describe("the path secret is the only thing guarding this endpoint", () => {
  it("rejects a wrong secret with 404, not 401", async () => {
    // 404 rather than 401: a wrong secret must not confirm the endpoint exists
    // to be guessed at.
    const response = await POST(request(received("hello")), ctx("wrong-secret-entirely"));

    expect(response.status).toBe(404);
    expect(await prisma.message.count()).toBe(0);
  });

  it("rejects a secret of the right length but wrong content", async () => {
    const nearMiss = SECRET.slice(0, -1) + "X";
    const response = await POST(request(received("hello")), ctx(nearMiss));

    expect(response.status).toBe(404);
    expect(await prisma.message.count()).toBe(0);
  });

  it("rejects an empty secret", async () => {
    expect((await POST(request(received("hello")), ctx(""))).status).toBe(404);
  });

  it("refuses to serve at all when no secret is configured", async () => {
    delete process.env.SMS_GATE_WEBHOOK_SECRET;
    resetEnvCache();

    // Failing closed: an unguarded receiver is worse than none, because this
    // endpoint can drive a booking.
    const response = await POST(request(received("hello")), ctx(SECRET));
    expect(response.status).toBe(503);
  });
});

describe("inbound messages", () => {
  it("stores a customer message and replies", async () => {
    const sent = installSpySms();
    const lead = await seedLead();

    const response = await POST(request(received("My AC is broken")), ctx(SECRET));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.leadId).toBe(lead.id);

    const stored = await prisma.message.findFirstOrThrow({ where: { direction: "INBOUND" } });
    expect(stored.body).toBe("My AC is broken");
    expect(sent.length).toBeGreaterThan(0);
  });

  it("suppresses a redelivered message rather than replying twice", async () => {
    const sent = installSpySms();
    await seedLead();

    const payload = received("Same message", "duplicate-id-1");
    await POST(request(payload), ctx(SECRET));
    const second = await POST(request(payload), ctx(SECRET));

    expect((await second.json()).duplicate).toBe(true);
    expect(await prisma.message.count({ where: { direction: "INBOUND" } })).toBe(1);
    // The gateway retrying must not cost a second text.
    expect(sent).toHaveLength(1);
  });

  it("honours STOP", async () => {
    installSpySms();
    const lead = await seedLead();

    await POST(request(received("STOP")), ctx(SECRET));

    const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated.smsOptedOutAt).not.toBeNull();
  });

  it("accepts fields at the top level as well as under payload", async () => {
    installSpySms();
    await seedLead();

    const flat = {
      event: "sms:received",
      messageId: "flat-shape-1",
      phoneNumber: CUSTOMER,
      message: "Flat payload shape",
      receivedAt: new Date().toISOString(),
    };

    expect((await POST(request(flat), ctx(SECRET))).status).toBe(200);
    expect(await prisma.message.count({ where: { direction: "INBOUND" } })).toBe(1);
  });
});

describe("delivery events", () => {
  it("acknowledges a delivery report without replying", async () => {
    const sent = installSpySms();
    await seedLead();

    const response = await POST(
      request({ event: "sms:delivered", payload: { messageId: "abc" } }),
      ctx(SECRET),
    );

    expect(response.status).toBe(200);
    // A delivery receipt is not a conversation turn.
    expect(sent).toHaveLength(0);
    expect(await prisma.message.count({ where: { direction: "INBOUND" } })).toBe(0);
  });

  it("accepts a failure report, which is the reason this gateway exists", async () => {
    // TextBee reported "dispatched" and three messages that never left the
    // handset looked identical to three that arrived.
    const response = await POST(
      request({ event: "sms:failed", payload: { messageId: "abc" } }),
      ctx(SECRET),
    );

    expect(response.status).toBe(200);
  });

  it("acknowledges an unknown event without acting on it", async () => {
    const response = await POST(request({ event: "app:started" }), ctx(SECRET));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.handled).toBe(false);
  });
});
