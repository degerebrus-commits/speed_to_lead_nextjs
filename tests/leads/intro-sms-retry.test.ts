import { beforeEach, describe, expect, it } from "vitest";

/** Never reset: ids must be unique for the life of the process, as a real gateway's are. */
let spyCounter = 0;
import { resetEnvCache } from "@/config/env";
import { prisma } from "@/lib/db";
import { countPendingIntroSms, retryPendingIntroSms } from "@/server/leads/intro-sms-retry";
import type { SmsMessage, SmsProvider } from "@/server/sms/sms-provider";
import { setSmsProviderForTesting } from "@/server/sms/sms-service";

function installSpy(): SmsMessage[] {
  const sent: SmsMessage[] = [];

  setSmsProviderForTesting({
    name: "spy",
    async send(message) {
      sent.push(message);
      // A counter, not sent.length. The length is read before the push, so two
      // concurrent sends - which retryPendingIntroSms does issue - both saw the
      // same value and returned the same id, tripping the unique constraint on
      // providerMessageId. Passed alone, failed under a loaded suite.
      return { providerMessageId: `spy-${++spyCounter}`, provider: "spy" };
    },
  });

  return sent;
}

let seq = 0;

async function seedLead(overrides: Record<string, unknown> = {}) {
  seq += 1;
  return prisma.lead.create({
    data: {
      name: `Lead ${seq}`,
      phone: `+1555000${String(seq).padStart(4, "0")}`,
      serviceAddress: "1 Test Street",
      initialMessage: `message ${seq}`,
      dedupeKey: `dedupe-${seq}-${Date.now()}-${Math.random()}`,
      // Consented by default: this suite is about the retry mechanism, and a
      // lead without consent is never sendable, so leaving it null here would
      // make every case pass for the wrong reason.
      smsConsentAt: new Date(),
      smsConsentSource: "website-form",
      ...overrides,
    },
  });
}

describe("retryPendingIntroSms", () => {
  let sent: SmsMessage[];

  beforeEach(() => {
    sent = installSpy();
  });

  it("sends to leads that never received an intro message", async () => {
    const stranded = await seedLead();

    const outcome = await retryPendingIntroSms();

    expect(outcome.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(stranded.phone);

    // The stamp is what takes it out of the queue - without it the next run
    // would text the same customer again.
    const updated = await prisma.lead.findUniqueOrThrow({ where: { id: stranded.id } });
    expect(updated.introSmsSentAt).not.toBeNull();
  });

  it("leaves already-contacted leads alone", async () => {
    await seedLead({ introSmsSentAt: new Date() });

    const outcome = await retryPendingIntroSms();

    expect(outcome.attempted).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("never texts a lead who opted out", async () => {
    await seedLead({ smsOptedOutAt: new Date() });

    const outcome = await retryPendingIntroSms();

    // Excluded from the batch entirely rather than counted as a failure.
    expect(outcome.attempted).toBe(0);
    expect(outcome.failed).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("takes the longest-waiting lead first", async () => {
    const older = await seedLead({ createdAt: new Date(Date.now() - 60 * 60 * 1000) });
    await seedLead({ createdAt: new Date() });

    await retryPendingIntroSms(1);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(older.phone);
  });

  it("respects the batch limit so one run cannot drain the month's quota", async () => {
    for (let i = 0; i < 5; i += 1) await seedLead();

    const outcome = await retryPendingIntroSms(2);

    expect(outcome.attempted).toBe(2);
    expect(outcome.sent).toBe(2);
    expect(await countPendingIntroSms()).toBe(3);
  });

  it("stops the run when the monthly cap is reached, rather than failing every lead", async () => {
    // A real provider name so the quota counter, which excludes console
    // sends, actually counts these.
    setSmsProviderForTesting({
      name: "metered",
      async send(message) {
        sent.push(message);
        return { providerMessageId: `metered-${++spyCounter}`, provider: "metered" };
      },
    });

    process.env.SMS_MONTHLY_LIMIT = "2";
    resetEnvCache();

    for (let i = 0; i < 5; i += 1) await seedLead();

    const outcome = await retryPendingIntroSms(5);

    expect(outcome.sent).toBe(2);
    expect(outcome.quotaExhausted).toBe(true);

    // The crucial distinction: the rest are still queued, not marked failed.
    expect(outcome.failed).toBe(0);
    expect(await countPendingIntroSms()).toBe(3);

    process.env.SMS_MONTHLY_LIMIT = "1000";
    resetEnvCache();
  });

  it("keeps going when one lead fails, and leaves it queued", async () => {
    const failing = await seedLead();
    await seedLead();

    setSmsProviderForTesting({
      name: "flaky",
      async send(message) {
        if (message.to === failing.phone) throw new Error("gateway rejected");
        sent.push(message);
        return { providerMessageId: `ok-${++spyCounter}`, provider: "flaky" };
      },
    });

    const outcome = await retryPendingIntroSms();

    expect(outcome.failed).toBe(1);
    expect(outcome.sent).toBe(1);

    // Still null, so the next run retries it - a failure must not silently
    // consume the lead.
    const stillPending = await prisma.lead.findUniqueOrThrow({ where: { id: failing.id } });
    expect(stillPending.introSmsSentAt).toBeNull();
  });

  it("is a no-op when the queue is empty", async () => {
    const outcome = await retryPendingIntroSms();

    expect(outcome).toMatchObject({ attempted: 0, sent: 0, skipped: 0, failed: 0 });
    expect(sent).toHaveLength(0);
  });
});
