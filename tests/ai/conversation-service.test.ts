import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/config/env";
import { prisma } from "@/lib/db";
import { setAiProviderForTesting } from "@/server/ai/ai-service";
import { handleCustomerReply } from "@/server/ai/conversation-service";
import { resolveCandidatesByKeys } from "@/server/booking/booking-service";
import type { SmsMessage, SmsProvider } from "@/server/sms/sms-provider";
import { setSmsProviderForTesting } from "@/server/sms/sms-service";

const CUSTOMER_PHONE = "+15551234567";

function installSpySms(): SmsMessage[] {
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
    process.env.BOOKING_MODE = "fixed";
    process.env.AVAILABLE_TIME_SLOTS = "Mon-Fri 9am,Mon-Fri 11am,Sat 10am";
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
      // Two sends now: the customer's holding message, and the alert to the
      // owner. Assert the customer's specifically, so this keeps meaning
      // "the customer was answered even with the model down".
      expect(sent.filter((message) => message.to === lead.phone)).toHaveLength(1);

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

  describe("booking", () => {
    it("offers numbered slots when the customer asks to book", async () => {
      const ai = installAi("should not be used");
      const lead = await seedLead();

      const outcome = await handleCustomerReply(lead, "Can I book someone in?");

      expect(outcome.kind).toBe("slots-offered");
      expect(ai.calls).toBe(0);

      const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(updated.status).toBe("APPOINTMENT_PENDING");

      // Three options, and the numbering the customer sees must match the
      // order recorded against the lead - that record is what the reply is
      // resolved against later.
      expect(updated.offeredSlotKeys).toHaveLength(3);

      const offered = resolveCandidatesByKeys(updated.offeredSlotKeys);
      offered.forEach((slot, index) => {
        expect(sent[0].body).toContain(`${index + 1}) ${slot.display}`);
      });

      // Deliberately not asserting a specific label: the list is chronological,
      // so which window comes first depends on the time of day the suite runs.
      // Pinning one here passes all morning and fails after lunch.
      expect(sent[0].body).toContain("reply with the number");
    });

    it("does not book when a number appears in an ordinary description", async () => {
      // The regression this exists for: slot matching ran on every inbound
      // message, so any 1-2 digit number was read as a slot choice. A customer
      // answering "what's wrong?" got a confirmed appointment they never asked
      // for, and the slot was consumed with no code path able to release it.
      const ai = installAi("Sorry to hear that - how long has it been like that?");
      const lead = await seedLead();

      const outcome = await handleCustomerReply(lead, "It's been broken for 3 days");

      expect(outcome.kind).not.toBe("booked");
      expect(await prisma.appointment.count({ where: { leadId: lead.id } })).toBe(0);
      expect(ai.calls).toBe(1);

      const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(updated.status).not.toBe("BOOKED");
    });

    it("does not book on a number until slots have actually been offered", async () => {
      const ai = installAi("Thanks - what seems to be the trouble?");
      const lead = await seedLead();

      await handleCustomerReply(lead, "I have 2 units in the house");
      expect(await prisma.appointment.count({ where: { leadId: lead.id } })).toBe(0);

      // ...and once offered, the same reply shape does book.
      await handleCustomerReply(lead, "Can I book someone in?");
      const outcome = await handleCustomerReply(lead, "2");

      expect(outcome.kind).toBe("booked");
      expect(ai.calls).toBe(1);
    });

    it("books an explicit slot label even before any offer", async () => {
      // A label cannot be typed by accident, so it carries its own intent and
      // must not be caught by the guard above.
      installAi("should not be used");
      const lead = await seedLead();

      const outcome = await handleCustomerReply(lead, "can you do Sat 10am");

      expect(outcome.kind).toBe("booked");
      // The confirmation carries the dated form, so the time survives but the
      // recurring-window wording does not.
      expect(outcome.reply).toContain("10am");
      expect(outcome.reply).toContain("Sat");

      const appointment = await prisma.appointment.findFirstOrThrow({
        where: { leadId: lead.id },
      });
      expect(appointment.slotLabel).toBe("Sat 10am");
    });

    it("does not offer more slots to a customer who is already booked", async () => {
      // Observed in a live SMS test: the customer replied "Yes thanks for the
      // booking", which contains "book", so intent matching fired and offered
      // three more times. They picked one out of politeness and ended up with
      // two appointments on the same afternoon - two technicians, one house.
      //
      // Intent matching cannot fix this. The phrases are substring-matched, so
      // "book" fires on "booking" no matter how the list is worded. What
      // settles it is the appointment that already exists.
      const ai = installAi("Glad we could help - see you then!");
      const lead = await seedLead();

      await handleCustomerReply(lead, "Can I book someone in?");
      await handleCustomerReply(lead, "1");
      expect(await prisma.appointment.count({ where: { leadId: lead.id } })).toBe(1);

      const before = sent.length;
      const outcome = await handleCustomerReply(lead, "Yes thanks for the booking");

      // Still exactly one appointment, and no numbered list was pushed at them.
      expect(await prisma.appointment.count({ where: { leadId: lead.id } })).toBe(1);
      expect(outcome.kind).not.toBe("slots-offered");
      expect(sent.slice(before).some((m) => m.body.includes("reply with the number"))).toBe(false);

      // It reaches the model instead, which can answer a thank-you naturally.
      expect(ai.calls).toBe(1);
    });

    it("still lets an already-booked customer reschedule", async () => {
      // The guard above must not trap someone who genuinely wants to change:
      // reschedule releases the appointment first, so the offer still reaches
      // them.
      installAi("should not be used");
      const lead = await seedLead();

      await handleCustomerReply(lead, "Can I book someone in?");
      await handleCustomerReply(lead, "1");

      const outcome = await handleCustomerReply(lead, "can we reschedule");

      expect(outcome.kind).toBe("slots-offered");
      expect(outcome.reply).toContain("reply with the number");
    });

    it("offers a different set when the customer turns the first one down", async () => {
      const ai = installAi("should not be used");
      const lead = await seedLead();

      await handleCustomerReply(lead, "Can I book someone in?");
      const first = (await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } }))
        .offeredSlotKeys;

      const outcome = await handleCustomerReply(lead, "none of those work for me");

      expect(outcome.kind).toBe("slots-offered");
      // Never the model: a rejection is a request for different times, and
      // asking the AI to invent availability is how a customer gets told about
      // a slot that does not exist.
      expect(ai.calls).toBe(0);

      const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });

      // A genuinely different set, and the first is remembered as declined so
      // it cannot come back around.
      expect(after.offeredSlotKeys).toHaveLength(3);
      for (const key of after.offeredSlotKeys) {
        expect(first).not.toContain(key);
      }
      expect(after.declinedSlotKeys).toEqual(expect.arrayContaining(first));
      expect(after.status).toBe("APPOINTMENT_PENDING");

      // And the customer is told these are new ones rather than being sent the
      // same message twice.
      expect(sent.at(-1)!.body).toContain("next few");
    });

    it("books from the second set, at the date that set offered", async () => {
      installAi("should not be used");
      const lead = await seedLead();

      await handleCustomerReply(lead, "Can I book someone in?");
      await handleCustomerReply(lead, "none of those work");

      const second = resolveCandidatesByKeys(
        (await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).offeredSlotKeys,
      );

      const outcome = await handleCustomerReply(lead, "1");

      expect(outcome.kind).toBe("booked");

      const appointment = await prisma.appointment.findFirstOrThrow({
        where: { leadId: lead.id },
      });
      // The occurrence from the *second* list. Re-resolving the label here
      // would book the soonest instead - a date this customer already refused.
      expect(appointment.slotKey).toBe(second[0].key);
      expect(appointment.scheduledAt?.toISOString()).toBe(second[0].at.toISOString());
    });

    it("hands off to a person once every slot has been turned down", async () => {
      // One window, so the horizon runs out quickly.
      process.env.AVAILABLE_TIME_SLOTS = "Sat 10am";
      process.env.SLOT_OFFER_COUNT = "3";
      resetEnvCache();

      installAi("should not be used");
      const lead = await seedLead();

      await handleCustomerReply(lead, "Can I book someone in?");

      // Keep refusing until the assistant gives up. Bounded so a bug that
      // never exhausts fails the test rather than hanging it.
      let outcome = await handleCustomerReply(lead, "none of those work");
      for (let attempt = 0; attempt < 5 && outcome.kind === "slots-offered"; attempt += 1) {
        outcome = await handleCustomerReply(lead, "none of those work");
      }

      expect(outcome.kind).toBe("handoff");
      expect(outcome.escalated).toBe(true);
      expect(outcome.reply).toContain("team");

      const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(after.status).toBe("HUMAN_HANDOFF");
      // Nothing was booked on the way out.
      expect(await prisma.appointment.count({ where: { leadId: lead.id } })).toBe(0);
    });

    it("does not treat a problem description starting with 'no' as a rejection", async () => {
      // A message opening with "no" must not be read as "none of those work",
      // which would burn a set of slots and offer times nobody asked about.
      // Deliberately not "no heat" - that is an emergency keyword and never
      // reaches this branch at all.
      const ai = installAi("Understood - I'll keep that in mind.");
      const lead = await seedLead();

      await handleCustomerReply(lead, "Can I book someone in?");
      const offered = (await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } }))
        .offeredSlotKeys;

      await handleCustomerReply(lead, "no rush on this one");

      const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(after.offeredSlotKeys).toEqual(offered);
      expect(after.declinedSlotKeys).toHaveLength(0);
      expect(ai.calls).toBe(1);
    });

    it("books the chosen slot and confirms it", async () => {
      const ai = installAi("should not be used");
      const lead = await seedLead();

      await handleCustomerReply(lead, "Can I book someone in?");

      // What "2" refers to, captured from the offer rather than assumed.
      const offered = resolveCandidatesByKeys(
        (await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).offeredSlotKeys,
      );
      const second = offered[1];

      const outcome = await handleCustomerReply(lead, "2");

      expect(outcome.kind).toBe("booked");
      expect(ai.calls).toBe(0);
      expect(outcome.reply).toContain(second.display);

      const appointment = await prisma.appointment.findFirstOrThrow({
        where: { leadId: lead.id },
      });
      // The second option offered, not the second configured window - the two
      // differ as soon as the list is chronological.
      expect(appointment.slotLabel).toBe(second.label);
      expect(appointment.slotKey).toBe(second.key);
      expect(appointment.confirmationSentAt).not.toBeNull();

      const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(updated.status).toBe("BOOKED");
    });

    it("still books outside business hours", async () => {
      // "Increase after-hours bookings" is a stated product goal, so the
      // holding message must not intercept somebody trying to book at 2am.
      const today = new Date().getUTCDay();
      process.env.BUSINESS_OPEN_DAYS = String(today === 1 ? 2 : 1);
      process.env.BUSINESS_OPEN_HOUR = "9";
      process.env.BUSINESS_CLOSE_HOUR = "10";
      resetEnvCache();

      const lead = await seedLead();
      installAi("unused");

      const offered = await handleCustomerReply(lead, "I need to schedule a visit");
      expect(offered.kind).toBe("slots-offered");

      const booked = await handleCustomerReply(lead, "1");
      expect(booked.kind).toBe("booked");
    });

    it("falls through to the AI when the message is not about booking", async () => {
      const ai = installAi("Is it blowing warm air?");
      const lead = await seedLead();

      const outcome = await handleCustomerReply(lead, "It stopped cooling last night");

      expect(outcome.kind).toBe("ai");
      expect(ai.calls).toBe(1);
    });

    it("an emergency still outranks a booking request", async () => {
      const lead = await seedLead();
      installAi("unused");

      const outcome = await handleCustomerReply(lead, "gas smell - can you book someone now");

      expect(outcome.kind).toBe("emergency");
      expect(await prisma.appointment.count()).toBe(0);
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
