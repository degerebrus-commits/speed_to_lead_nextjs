import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/config/env";
import { prisma } from "@/lib/db";
import { setAiProviderForTesting } from "@/server/ai/ai-service";
import { handleCustomerReply } from "@/server/ai/conversation-service";
import type { SmsMessage, SmsProvider } from "@/server/sms/sms-provider";
import { setSmsProviderForTesting } from "@/server/sms/sms-service";

const CUSTOMER_PHONE = "+15551234567";

function installSpySms(): SmsMessage[] {
  const sent: SmsMessage[] = [];

  const spy: SmsProvider = {
    name: "spy",
    async send(message) {
      sent.push(message);
      return { providerMessageId: `spy-${sent.length}`, provider: "spy" };
    },
  };

  setSmsProviderForTesting(spy);
  return sent;
}

function installAi(reply: string): { calls: number } {
  const state = { calls: 0 };

  setAiProviderForTesting({
    name: "stub-ai",
    model: "stub",
    async complete() {
      state.calls += 1;
      return {
        text: reply,
        model: "stub",
        provider: "stub-ai",
        inputTokens: null,
        outputTokens: null,
      };
    },
  });

  return state;
}

async function seedLead(overrides: Record<string, unknown> = {}) {
  return prisma.lead.create({
    data: {
      name: "John Carter",
      phone: CUSTOMER_PHONE,
      serviceAddress: "42 Oak Street",
      initialMessage: "My AC is not cooling.",
      dedupeKey: `dedupe-${Date.now()}-${Math.random()}`,
      ...overrides,
    },
  });
}

describe("handleCustomerReply", () => {
  let sent: SmsMessage[];

  beforeEach(() => {
    // Open for business, so the after-hours branch does not interfere.
    process.env.BUSINESS_OPEN_DAYS = "1,2,3,4,5,6,7";
    process.env.BUSINESS_OPEN_HOUR = "0";
    process.env.BUSINESS_CLOSE_HOUR = "24";
    process.env.EMERGENCY_KEYWORDS = "no heat,gas smell,carbon monoxide";
    process.env.AFTER_HOURS_REPLY_ENABLED = "true";
    resetEnvCache();

    sent = installSpySms();
  });

  it("answers an ordinary message with the AI reply and marks the lead engaged", async () => {
    const ai = installAi("Sorry to hear that. Is it blowing warm air, or nothing at all?");
    const lead = await seedLead();

    const outcome = await handleCustomerReply(lead, "My aircon is broken");

    expect(outcome.kind).toBe("ai");
    expect(ai.calls).toBe(1);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(CUSTOMER_PHONE);
    expect(sent[0].body).toBe("Sorry to hear that. Is it blowing warm air, or nothing at all?");

    const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated.status).toBe("ENGAGED");

    // The reply must be recorded, or the next turn loses this half of the
    // conversation and the model repeats itself.
    const outbound = await prisma.message.findFirstOrThrow({ where: { direction: "OUTBOUND" } });
    expect(outbound.leadId).toBe(lead.id);
  });

  describe("emergencies", () => {
    it("short-circuits the AI entirely", async () => {
      const ai = installAi("this should never be sent");
      const lead = await seedLead();

      const outcome = await handleCustomerReply(lead, "I smell gas smell in the kitchen");

      expect(outcome.kind).toBe("emergency");
      expect(outcome.escalated).toBe(true);

      // The whole point: safety does not depend on the model being reachable.
      expect(ai.calls).toBe(0);
    });

    it("escalates the lead to HUMAN_HANDOFF", async () => {
      installAi("unused");
      const lead = await seedLead();

      await handleCustomerReply(lead, "carbon monoxide alarm is going off");

      const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(updated.status).toBe("HUMAN_HANDOFF");
    });

    it("still escalates when the AI provider is completely broken", async () => {
      setAiProviderForTesting({
        name: "broken",
        model: "broken",
        async complete() {
          throw new Error("provider down");
        },
      });

      const lead = await seedLead();
      const outcome = await handleCustomerReply(lead, "no heat and it is freezing");

      expect(outcome.kind).toBe("emergency");
      expect(sent).toHaveLength(1);

      const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(updated.status).toBe("HUMAN_HANDOFF");
    });
  });

  describe("after hours", () => {
    beforeEach(() => {
      // Closed on every day, so "now" is always outside hours.
      process.env.BUSINESS_OPEN_DAYS = "";
      process.env.BUSINESS_OPEN_HOUR = "9";
      process.env.BUSINESS_CLOSE_HOUR = "9";
      resetEnvCache();
    });

    it("sends the holding message instead of calling the AI", async () => {
      // An empty day list means "unknown schedule" and deliberately stays
      // open, so pin a real day that excludes today instead.
      const today = new Date().getUTCDay();
      const excluded = today === 0 ? "1" : String(today === 1 ? 2 : 1);
      process.env.BUSINESS_OPEN_DAYS = excluded;
      resetEnvCache();

      const ai = installAi("should not be used");
      const lead = await seedLead();

      const outcome = await handleCustomerReply(lead, "My aircon is broken");

      expect(outcome.kind).toBe("after-hours");
      expect(ai.calls).toBe(0);
      expect(sent).toHaveLength(1);
      expect(sent[0].body).toContain("first thing in the morning");
    });
  });

  it("never messages a lead who has opted out", async () => {
    const ai = installAi("should not be used");
    const lead = await seedLead({ smsOptedOutAt: new Date() });

    const outcome = await handleCustomerReply(lead, "My aircon is broken");

    expect(outcome.kind).toBe("none");
    expect(outcome.reply).toBeNull();
    expect(ai.calls).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("gives the model the conversation so far, in order", async () => {
    const lead = await seedLead();

    await prisma.message.createMany({
      data: [
        {
          leadId: lead.id,
          direction: "OUTBOUND",
          phone: CUSTOMER_PHONE,
          body: "Hi, this is Comfort Pro. What's going on with your system?",
          provider: "spy",
          providerMessageId: "hist-1",
          sentAt: new Date(Date.now() - 60_000),
        },
        {
          leadId: lead.id,
          direction: "INBOUND",
          phone: CUSTOMER_PHONE,
          body: "It stopped cooling last night",
          provider: "spy",
          providerMessageId: "hist-2",
          receivedAt: new Date(Date.now() - 30_000),
        },
      ],
    });

    let seenRoles: string[] = [];
    setAiProviderForTesting({
      name: "capture",
      model: "stub",
      async complete(request) {
        seenRoles = request.messages.map((message) => message.role);
        return {
          text: "Understood.",
          model: "stub",
          provider: "capture",
          inputTokens: null,
          outputTokens: null,
        };
      },
    });

    await handleCustomerReply(lead, "Still not cooling");

    // System prompt first, then the stored turns mapped by direction.
    expect(seenRoles[0]).toBe("system");
    expect(seenRoles.slice(1)).toEqual(["assistant", "user"]);
  });
});
