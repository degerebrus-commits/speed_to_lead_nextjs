import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetEnvCache } from "@/config/env";
import { prisma } from "@/lib/db";
import { sendDueReminders } from "@/server/booking/appointment-reminders";
import { setSmsProviderForTesting } from "@/server/sms/sms-service";

/**
 * The reminder before a visit.
 *
 * Exists because the confirmation used to be the last message a customer ever
 * received. Once booked they had no further chance to call it off, so the first
 * anyone heard was a technician outside the house.
 *
 * The behaviour worth guarding is idempotency: a scheduler firing every few
 * minutes must not text the same customer repeatedly.
 */

const NOW = new Date("2026-08-21T02:00:00.000Z");
const ORIGINAL = process.env.APPOINTMENT_REMINDER_MINUTES;

let sent: Array<{ to: string; body: string }> = [];
let counter = 0;

beforeEach(() => {
  sent = [];
  process.env.APPOINTMENT_REMINDER_MINUTES = "60";
  resetEnvCache();

  setSmsProviderForTesting({
    name: "spy",
    async send({ to, body }) {
      sent.push({ to, body });
      // A counter, never the array length: length is read before the push, so
      // concurrent sends would collide on providerMessageId.
      counter += 1;
      return { providerMessageId: `reminder-${counter}`, provider: "spy" };
    },
  });
});

afterEach(() => {
  setSmsProviderForTesting(null);
  if (ORIGINAL === undefined) delete process.env.APPOINTMENT_REMINDER_MINUTES;
  else process.env.APPOINTMENT_REMINDER_MINUTES = ORIGINAL;
  resetEnvCache();
});

let seq = 0;

async function book(options: {
  minutesFromNow: number;
  optedOut?: boolean;
  reminded?: boolean;
  status?: "CONFIRMED" | "CANCELLED";
}) {
  seq += 1;

  const lead = await prisma.lead.create({
    data: {
      name: `Reminder Test ${seq}`,
      phone: `+1555700${String(seq).padStart(4, "0")}`,
      serviceAddress: "1 Test Street",
      initialMessage: "No cooling.",
      dedupeKey: `reminder-${seq}-${Date.now()}-${Math.random()}`,
      smsConsentAt: new Date(),
      smsOptedOutAt: options.optedOut ? new Date() : null,
      status: "BOOKED",
    },
  });

  const at = new Date(NOW.getTime() + options.minutesFromNow * 60 * 1000);

  return prisma.appointment.create({
    data: {
      leadId: lead.id,
      slotLabel: "Mon-Fri 9am",
      slotKey: `reminder-key-${seq}-${Date.now()}`,
      scheduledAt: at,
      scheduledEndAt: new Date(at.getTime() + 90 * 60 * 1000),
      durationMinutes: 90,
      status: options.status ?? "CONFIRMED",
      reminderSentAt: options.reminded ? new Date() : null,
    },
  });
}

describe("sendDueReminders", () => {
  it("reminds a visit starting inside the window", async () => {
    await book({ minutesFromNow: 45 });

    const run = await sendDueReminders(NOW);

    expect(run.due).toBe(1);
    expect(run.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain("Reminder");
  });

  it("leaves a visit further out alone", async () => {
    await book({ minutesFromNow: 240 });

    const run = await sendDueReminders(NOW);

    expect(run.due).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("does not remind a visit that has already started", async () => {
    // Without a lower bound, the first run would text every past customer.
    await book({ minutesFromNow: -30 });

    const run = await sendDueReminders(NOW);

    expect(run.due).toBe(0);
  });

  it("never sends twice, however often the scheduler fires", async () => {
    await book({ minutesFromNow: 30 });

    await sendDueReminders(NOW);
    const second = await sendDueReminders(NOW);

    expect(second.due).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("skips a cancelled visit", async () => {
    await book({ minutesFromNow: 30, status: "CANCELLED" });

    expect((await sendDueReminders(NOW)).due).toBe(0);
  });

  it("skips a customer who opted out", async () => {
    // They asked not to be texted. A reminder is still a text.
    await book({ minutesFromNow: 30, optedOut: true });

    const run = await sendDueReminders(NOW);

    expect(run.due).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("stamps the appointment even when the send fails", async () => {
    // A gateway refusing messages now will refuse them on the next pass too.
    // Retrying every few minutes would text the customer a dozen times the
    // moment it recovers, which is worse than one missed reminder.
    setSmsProviderForTesting({
      name: "broken",
      async send() {
        throw new Error("gateway down");
      },
    });

    const appointment = await book({ minutesFromNow: 30 });

    const run = await sendDueReminders(NOW);

    expect(run.failed).toBe(1);

    const stored = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
    });
    expect(stored.reminderSentAt).not.toBeNull();
    expect((await sendDueReminders(NOW)).due).toBe(0);
  });

  it("tells the customer when the visit is, and how to call it off", async () => {
    await book({ minutesFromNow: 30 });

    await sendDueReminders(NOW);

    // The whole point of the reminder is the last chance to cancel.
    expect(sent[0].body).toContain("CANCEL");
  });
});
