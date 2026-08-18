import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { leadWebhookSchema } from "@/lib/validation/lead-schema";
import { retryPendingIntroSms } from "@/server/leads/intro-sms-retry";
import { createLead } from "@/server/leads/lead-service";
import type { SmsMessage, SmsProvider } from "@/server/sms/sms-provider";
import {
  SmsSuppressedError,
  sendHelpReply,
  sendIntroSms,
  setSmsProviderForTesting,
} from "@/server/sms/sms-service";

const DISCLOSURE =
  "By submitting this form and signing up for texts, you consent to receive text messages...";

function installSpySms(): SmsMessage[] {
  const sent: SmsMessage[] = [];

  const spy: SmsProvider = {
    name: "spy",
    async send(message) {
      sent.push(message);
      return { providerMessageId: `spy-${sent.length}-${Math.random()}`, provider: "spy" };
    },
  };

  setSmsProviderForTesting(spy);
  return sent;
}

const BASE_INPUT = {
  name: "John Carter",
  phone: "+15551234567",
  serviceAddress: "42 Oak Street",
  message: "My AC is not cooling.",
};

describe("consent capture", () => {
  it("records when consent was given and exactly what was agreed to", async () => {
    const input = leadWebhookSchema.parse({
      ...BASE_INPUT,
      smsConsent: true,
      smsConsentText: DISCLOSURE,
    });

    const { lead } = await createLead(input);

    expect(lead.smsConsentAt).not.toBeNull();
    // The wording is stored verbatim: "they consented" is only defensible if
    // we can produce what they consented to.
    expect(lead.smsConsentText).toBe(DISCLOSURE);
    expect(lead.smsConsentSource).toBe("website-form");
  });

  it("accepts the string forms a checkbox actually posts", async () => {
    for (const value of ["true", "on", "yes", "1"]) {
      const parsed = leadWebhookSchema.parse({ ...BASE_INPUT, smsConsent: value });
      expect(parsed.smsConsent, value).toBe(true);
    }

    for (const value of ["false", "no", "0"]) {
      const parsed = leadWebhookSchema.parse({ ...BASE_INPUT, smsConsent: value });
      expect(parsed.smsConsent, value).toBe(false);
    }
  });

  it("stores the lead when consent is absent rather than rejecting it", async () => {
    // The client's form may not send the field yet. Losing a real customer
    // over a missing checkbox would be worse than holding the text.
    const input = leadWebhookSchema.parse(BASE_INPUT);
    const { lead, isNew } = await createLead(input);

    expect(isNew).toBe(true);
    expect(lead.smsConsentAt).toBeNull();
  });

  it("ignores consent text when consent itself was not given", async () => {
    const input = leadWebhookSchema.parse({
      ...BASE_INPUT,
      smsConsent: false,
      smsConsentText: DISCLOSURE,
    });

    const { lead } = await createLead(input);

    expect(lead.smsConsentAt).toBeNull();
    expect(lead.smsConsentText).toBeNull();
  });
});

describe("consent gates sending", () => {
  it("refuses to send the intro SMS without recorded consent", async () => {
    const sent = installSpySms();
    const { lead } = await createLead(leadWebhookSchema.parse(BASE_INPUT));

    await expect(sendIntroSms(lead)).rejects.toThrow(SmsSuppressedError);
    // Assert nothing left the building, not merely that it threw.
    expect(sent).toHaveLength(0);

    const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(stored.introSmsSentAt).toBeNull();
  });

  it("names the reason so the dashboard can distinguish it from a failure", async () => {
    installSpySms();
    const { lead } = await createLead(leadWebhookSchema.parse(BASE_INPUT));

    await expect(sendIntroSms(lead)).rejects.toMatchObject({ reason: "no-consent" });
  });

  it("sends when consent is recorded", async () => {
    const sent = installSpySms();
    const { lead } = await createLead(
      leadWebhookSchema.parse({ ...BASE_INPUT, smsConsent: true, smsConsentText: DISCLOSURE }),
    );

    await sendIntroSms(lead);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("+15551234567");
  });

  it("keeps unconsented leads out of the retry queue entirely", async () => {
    const sent = installSpySms();
    await createLead(leadWebhookSchema.parse(BASE_INPUT));

    const outcome = await retryPendingIntroSms();

    // Not "attempted and failed" - it can never succeed, and reporting it as a
    // failure every run would bury the transient ones worth chasing.
    expect(outcome.attempted).toBe(0);
    expect(outcome.failed).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe("HELP reply", () => {
  it("names the business and repeats how to opt out", async () => {
    const sent = installSpySms();
    const { lead } = await createLead(
      leadWebhookSchema.parse({ ...BASE_INPUT, smsConsent: true }),
    );

    await sendHelpReply(lead);

    expect(sent).toHaveLength(1);
    // tests/setup.ts sets a business name that appears nowhere in .env.example,
    // so this also proves the copy came from configuration.
    expect(sent[0].body).toContain("Northwind Heating & Air");
    expect(sent[0].body).toContain("STOP");
  });

  it("answers a customer who has opted out", async () => {
    // The one send that ignores the opt-out guard: HELP replies to a message
    // they just sent, and someone who has opted out is exactly the person
    // likely to ask how to reach a human.
    const sent = installSpySms();
    const { lead } = await createLead(
      leadWebhookSchema.parse({ ...BASE_INPUT, smsConsent: true }),
    );

    await prisma.lead.update({
      where: { id: lead.id },
      data: { smsOptedOutAt: new Date() },
    });

    const optedOut = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    await sendHelpReply(optedOut);

    expect(sent).toHaveLength(1);
  });

  it("answers a lead with no recorded consent", async () => {
    const sent = installSpySms();
    const { lead } = await createLead(leadWebhookSchema.parse(BASE_INPUT));

    await sendHelpReply(lead);

    expect(sent).toHaveLength(1);
  });

  it("records the reply as an outbound message", async () => {
    installSpySms();
    const { lead } = await createLead(
      leadWebhookSchema.parse({ ...BASE_INPUT, smsConsent: true }),
    );

    await sendHelpReply(lead);

    const messages = await prisma.message.findMany({ where: { leadId: lead.id } });
    expect(messages).toHaveLength(1);
    expect(messages[0].direction).toBe("OUTBOUND");
  });
});
