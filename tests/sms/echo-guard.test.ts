import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { handleInboundMessage } from "@/server/sms/inbound-message-service";

const PHONE = "+15551239999";

let seq = 0;
async function seedLead() {
  seq += 1;
  return prisma.lead.create({
    data: {
      name: "John Carter",
      phone: PHONE,
      serviceAddress: "42 Oak Street",
      initialMessage: "No cooling.",
      dedupeKey: `echo-${seq}-${Date.now()}-${Math.random()}`,
      smsConsentAt: new Date(),
    },
  });
}

async function weSent(leadId: string, body: string, at = new Date()) {
  return prisma.message.create({
    data: {
      leadId,
      direction: "OUTBOUND",
      phone: PHONE,
      body,
      provider: "test",
      providerMessageId: `out-${Math.random()}`,
      sentAt: at,
      createdAt: at,
    },
  });
}

function inbound(message: string) {
  return {
    event: "MESSAGE_RECEIVED" as const,
    timestamp: new Date().toISOString(),
    data: {
      _id: `in-${Math.random()}`,
      sender: PHONE,
      message,
      receivedAt: new Date().toISOString(),
    },
  };
}

/**
 * The loop this prevents: a handset registered as the gateway reports the
 * messages it just sent as received, because sender and recipient are the same
 * number. Answering one makes the assistant reply to itself indefinitely.
 */
describe("our own message coming back", () => {
  it("is recognised and not treated as a customer reply", async () => {
    const lead = await seedLead();
    const ours = "I can get someone out to you. Which works best - 1) Mon-Fri 9am?";
    await weSent(lead.id, ours);

    const result = await handleInboundMessage(inbound(ours));

    expect(result.isEcho).toBe(true);
    // Reported with keyword null so no caller branch can fire on it.
    expect(result.keyword).toBeNull();
  });

  it("is still stored, so the loop is visible in the transcript", async () => {
    const lead = await seedLead();
    const ours = "You're all set! Your appointment is confirmed.";
    await weSent(lead.id, ours);

    await handleInboundMessage(inbound(ours));

    const stored = await prisma.message.findFirst({ where: { direction: "INBOUND" } });
    expect(stored?.body).toBe(ours);
  });

  it("does not opt the customer out of their own confirmation", async () => {
    // The booking confirmation ends "Reply STOP to opt out". Echoed back and
    // classified, that would unsubscribe the customer from the message they
    // just received.
    const lead = await seedLead();
    const confirmation = "You're all set! Your appointment is confirmed. Reply STOP to opt out.";
    await weSent(lead.id, confirmation);

    await handleInboundMessage(inbound(confirmation));

    const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated.smsOptedOutAt).toBeNull();
  });

  it("does not fire on a genuine customer reply", async () => {
    const lead = await seedLead();
    await weSent(lead.id, "Which works best - 1) Mon-Fri 9am, 2) Sat 10am?");

    const result = await handleInboundMessage(inbound("2"));

    // A real answer must always get through.
    expect(result.isEcho).toBeFalsy();
    expect(result.leadId).toBe(lead.id);
  });

  it("does not fire on our own wording sent long ago", async () => {
    const lead = await seedLead();
    const ours = "Can you tell me a little about the issue?";

    // Outside the ten-minute window: a customer quoting us hours later is a
    // customer, not an echo.
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await weSent(lead.id, ours, old);

    const result = await handleInboundMessage(inbound(ours));

    expect(result.isEcho).toBeFalsy();
  });

  it("matches only the exact text, not a paraphrase", async () => {
    const lead = await seedLead();
    await weSent(lead.id, "Which works best - 1) Mon-Fri 9am, 2) Sat 10am?");

    const result = await handleInboundMessage(inbound("the 9am one works best"));

    expect(result.isEcho).toBeFalsy();
  });

  it("is scoped to the number, so another lead's text is not an echo", async () => {
    const lead = await seedLead();
    const ours = "Thanks - what seems to be the trouble?";
    await weSent(lead.id, ours);

    const other = await prisma.lead.create({
      data: {
        name: "Someone Else",
        phone: "+15550001111",
        serviceAddress: "1 Other Street",
        initialMessage: "No heat.",
        dedupeKey: `other-${Date.now()}-${Math.random()}`,
        smsConsentAt: new Date(),
      },
    });

    const result = await handleInboundMessage({
      event: "MESSAGE_RECEIVED",
      timestamp: new Date().toISOString(),
      data: {
        _id: `in-${Math.random()}`,
        sender: other.phone,
        message: ours,
        receivedAt: new Date().toISOString(),
      },
    });

    expect(result.isEcho).toBeFalsy();
  });
});
