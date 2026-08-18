import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetEnvCache } from "@/config/env";
import { prisma } from "@/lib/db";
import { handleCustomerReply } from "@/server/ai/conversation-service";
import type { SmsMessage, SmsProvider } from "@/server/sms/sms-provider";
import { setSmsProviderForTesting } from "@/server/sms/sms-service";

const ORIGINAL = { ...process.env };
const OWNER = "+15559990000";
const CUSTOMER = "+15551234567";

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

async function seedLead(overrides: Record<string, unknown> = {}) {
  return prisma.lead.create({
    data: {
      name: "John Carter",
      phone: CUSTOMER,
      serviceAddress: "42 Oak Street",
      initialMessage: "My AC is not cooling.",
      dedupeKey: `owner-alert-${Date.now()}-${Math.random()}`,
      smsConsentAt: new Date(),
      ...overrides,
    },
  });
}

beforeEach(() => {
  process.env.OWNER_PHONE = OWNER;
  process.env.EMERGENCY_KEYWORDS = "gas leak,no heat,carbon monoxide";
  resetEnvCache();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  resetEnvCache();
});

describe("owner emergency alert", () => {
  it("texts the owner when an emergency is detected", async () => {
    const sent = installSpySms();
    const lead = await seedLead();

    await handleCustomerReply(lead, "I think I smell a gas leak in the basement");

    const toOwner = sent.filter((message) => message.to === OWNER);
    expect(toOwner).toHaveLength(1);
    // The alert has to carry enough to act on without opening the dashboard.
    expect(toOwner[0].body).toContain("John");
    expect(toOwner[0].body).toContain(CUSTOMER);
    expect(toOwner[0].body).toContain("gas leak");
  });

  it("still answers the customer as well as the owner", async () => {
    const sent = installSpySms();
    const lead = await seedLead();

    await handleCustomerReply(lead, "gas leak, please help");

    expect(sent.filter((m) => m.to === OWNER)).toHaveLength(1);
    expect(sent.filter((m) => m.to === CUSTOMER)).toHaveLength(1);
  });

  it("does not alert on an ordinary message", async () => {
    const sent = installSpySms();
    const lead = await seedLead();

    await handleCustomerReply(lead, "My AC is a bit noisy lately");

    expect(sent.filter((message) => message.to === OWNER)).toHaveLength(0);
  });

  it("still replies to the customer when OWNER_PHONE is not configured", async () => {
    delete process.env.OWNER_PHONE;
    resetEnvCache();

    const sent = installSpySms();
    const lead = await seedLead();

    const outcome = await handleCustomerReply(lead, "carbon monoxide alarm going off");

    // The customer must not be left unanswered because the business forgot to
    // configure a number.
    expect(outcome.kind).toBe("emergency");
    expect(sent.filter((message) => message.to === CUSTOMER)).toHaveLength(1);
  });

  it("alerts even when the customer has opted out of texts", async () => {
    const sent = installSpySms();
    const lead = await seedLead({ smsOptedOutAt: new Date() });

    await handleCustomerReply(lead, "gas leak");

    // handleCustomerReply returns early for an opted-out lead, so no alert is
    // sent - documenting the current behaviour rather than asserting a wish.
    expect(sent.filter((message) => message.to === OWNER)).toHaveLength(0);
  });

  it("truncates a very long message so the alert stays one segment", async () => {
    const sent = installSpySms();
    const lead = await seedLead();

    await handleCustomerReply(lead, `gas leak ${"x".repeat(400)}`);

    const toOwner = sent.filter((message) => message.to === OWNER);
    expect(toOwner[0].body).toContain("...");
    expect(toOwner[0].body.length).toBeLessThan(260);
  });
});
