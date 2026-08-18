import type { Lead } from "@prisma/client";
import { getBusinessProfile, getMessageTemplates } from "@/config/business";
import { getEnv } from "@/config/env";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { consoleSmsProvider } from "./console-sms-provider";
import { textBeeSmsProvider } from "./textbee-sms-provider";
import type { SmsProvider } from "./sms-provider";
import { buildIntroMessage, renderTemplate } from "./sms-templates";

let providerOverride: SmsProvider | null = null;

/** Test-only. Lets a spec substitute a spy and assert what the caller sent. */
export function setSmsProviderForTesting(provider: SmsProvider | null): void {
  providerOverride = provider;
}

export function getSmsProvider(): SmsProvider {
  if (providerOverride) return providerOverride;

  const { SMS_PROVIDER } = getEnv();

  if (SMS_PROVIDER === "twilio") {
    // Fail loudly rather than silently logging to console: a deployment that
    // believes it is texting customers and is not would be worse than a crash.
    throw new Error("SMS_PROVIDER=twilio is not implemented yet - it needs the client's account");
  }

  if (SMS_PROVIDER === "textbee") {
    // Belt and braces against a misconfigured test run spending real quota.
    // tests/setup.ts pins SMS_PROVIDER=console, but a stray .env would not.
    if (process.env.NODE_ENV === "test") {
      throw new Error("Refusing to use the real SMS gateway during tests");
    }
    return textBeeSmsProvider;
  }

  return consoleSmsProvider;
}

/** Thrown when a send is refused before it reaches the gateway. */
export class SmsSuppressedError extends Error {
  constructor(
    message: string,
    readonly reason: "opted-out" | "quota-exhausted" | "no-consent",
  ) {
    super(message);
    this.name = "SmsSuppressedError";
  }
}

function startOfCurrentMonth(): Date {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

/**
 * Refuses to send once the configured monthly ceiling is reached.
 *
 * Counts real outbound messages this calendar month - console sends are
 * excluded because they cost nothing. Deliberately a read-then-check: two
 * simultaneous sends could both pass at the boundary. Acceptable for a spend
 * guard, which protects a quota rather than a business invariant.
 */
async function assertMonthlyQuotaRemaining(providerName: string): Promise<void> {
  const { SMS_MONTHLY_LIMIT } = getEnv();

  const sentThisMonth = await prisma.message.count({
    where: {
      direction: "OUTBOUND",
      provider: providerName,
      sentAt: { gte: startOfCurrentMonth() },
    },
  });

  if (sentThisMonth >= SMS_MONTHLY_LIMIT) {
    throw new SmsSuppressedError(
      `Monthly SMS limit reached (${sentThisMonth}/${SMS_MONTHLY_LIMIT}). ` +
        "Raise SMS_MONTHLY_LIMIT or wait for the quota to reset.",
      "quota-exhausted",
    );
  }
}

/**
 * Sends the introductory SMS for a newly captured lead.
 *
 * Only stamps introSmsSentAt - the lead stays NEW. Moving the lifecycle to
 * CONTACTED waits for a delivery receipt; acceptance by the gateway is not
 * proof a customer received anything. Until then the null timestamp is the
 * work queue of leads still owed a first message.
 */
export async function sendIntroSms(lead: Lead): Promise<void> {
  // Opt-out is checked before anything else. A customer who texted STOP must
  // not be messaged again, whatever the rest of the system believes.
  if (lead.smsOptedOutAt) {
    throw new SmsSuppressedError(
      `Lead ${lead.id} has opted out of SMS`,
      "opted-out",
    );
  }

  // No recorded consent, no message. Express written consent is what makes an
  // automated text lawful, and it is what the A2P 10DLC registration is audited
  // against - a lead whose form did not carry a consent tick is stored and
  // surfaced on the dashboard for a human to call instead.
  if (!lead.smsConsentAt) {
    throw new SmsSuppressedError(
      `Lead ${lead.id} has no recorded SMS consent`,
      "no-consent",
    );
  }

  const provider = getSmsProvider();

  // Only real gateways consume quota; the console stub is free.
  if (provider.name !== "console") {
    await assertMonthlyQuotaRemaining(provider.name);
  }

  const business = getBusinessProfile();
  const body = buildIntroMessage(lead.name, business.name, getMessageTemplates().intro);

  const result = await provider.send({ to: lead.phone, body });
  const sentAt = new Date();

  await prisma.$transaction([
    prisma.lead.update({
      where: { id: lead.id },
      data: { introSmsSentAt: sentAt },
    }),
    prisma.message.create({
      data: {
        leadId: lead.id,
        direction: "OUTBOUND",
        phone: lead.phone,
        body,
        providerMessageId: result.providerMessageId,
        provider: result.provider,
        sentAt,
      },
    }),
  ]);

  logger.info("Intro SMS sent", {
    leadId: lead.id,
    provider: result.provider,
    providerMessageId: result.providerMessageId,
  });
}

/**
 * Sends an arbitrary message within an existing conversation.
 *
 * Shares every guard with the introductory send - opt-out, monthly quota, and
 * recording an OUTBOUND row - because a conversation reply costs exactly what
 * a first contact costs, and a customer who texted STOP must not receive one
 * merely because the message originated somewhere else in the code.
 */
export async function sendConversationSms(lead: Lead, body: string): Promise<void> {
  if (lead.smsOptedOutAt) {
    throw new SmsSuppressedError(`Lead ${lead.id} has opted out of SMS`, "opted-out");
  }

  const provider = getSmsProvider();

  if (provider.name !== "console") {
    await assertMonthlyQuotaRemaining(provider.name);
  }

  const result = await provider.send({ to: lead.phone, body });

  await prisma.message.create({
    data: {
      leadId: lead.id,
      direction: "OUTBOUND",
      phone: lead.phone,
      body,
      providerMessageId: result.providerMessageId,
      provider: result.provider,
      sentAt: new Date(),
    },
  });

  logger.info("Conversation SMS sent", {
    leadId: lead.id,
    provider: result.provider,
    providerMessageId: result.providerMessageId,
  });
}

/**
 * The fixed reply to HELP.
 *
 * Deliberately bypasses both the opt-out and consent guards, which is the only
 * send in the system that does. HELP is a reply to a message the customer just
 * sent us, and the disclosure they agreed to promises an answer - someone who
 * has opted out is precisely the person likely to text HELP asking how to reach
 * a human, and silence would be the wrong answer both to them and to a
 * regulator. Quota still applies: an exhausted gateway cannot send anything.
 */
export async function sendHelpReply(lead: Lead): Promise<void> {
  const provider = getSmsProvider();

  if (provider.name !== "console") {
    await assertMonthlyQuotaRemaining(provider.name);
  }

  const business = getBusinessProfile();
  const body = renderTemplate(getMessageTemplates().help, {
    firstName: lead.name.split(/\s+/)[0] ?? lead.name,
    businessName: business.name,
    repName: business.repName,
    // Falls back to the business name when no owner phone is configured, so
    // the reply never ships a customer a literal "{ownerPhone}".
    ownerPhone: business.ownerPhone ?? business.name,
  });

  const result = await provider.send({ to: lead.phone, body });

  await prisma.message.create({
    data: {
      leadId: lead.id,
      direction: "OUTBOUND",
      phone: lead.phone,
      body,
      providerMessageId: result.providerMessageId,
      provider: result.provider,
      sentAt: new Date(),
    },
  });

  logger.info("HELP reply sent", { leadId: lead.id, provider: result.provider });
}

/**
 * Texts the business owner that a customer has an emergency.
 *
 * Returns false when OWNER_PHONE is not configured, rather than throwing: an
 * unalerted emergency is bad, but an exception here would abort the reply the
 * customer is waiting on, which is worse. The caller logs the miss.
 *
 * The lead's own opt-out does not apply - the recipient is the business, not
 * the customer, and someone who texted STOP can still have a gas leak. No
 * OUTBOUND Message row is written either: that table is the customer's
 * conversation, and an internal alert is not part of it.
 */
export async function sendOwnerEmergencyAlert(
  lead: Lead,
  customerMessage: string,
): Promise<boolean> {
  const business = getBusinessProfile();

  if (!business.ownerPhone) return false;

  const provider = getSmsProvider();

  if (provider.name !== "console") {
    await assertMonthlyQuotaRemaining(provider.name);
  }

  const body = renderTemplate(getMessageTemplates().ownerAlert, {
    firstName: lead.name.split(/\s+/)[0] ?? lead.name,
    businessName: business.name,
    repName: business.repName,
    phone: lead.phone,
    // Truncated so one long text cannot push the alert over a segment
    // boundary and cost the business several messages.
    message: customerMessage.length > 140
      ? `${customerMessage.slice(0, 137)}...`
      : customerMessage,
  });

  const result = await provider.send({ to: business.ownerPhone, body });

  logger.warn("Owner alerted to emergency", {
    leadId: lead.id,
    provider: result.provider,
  });

  return true;
}
