import { generateKeyPairSync } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCache } from "@/config/env";
import { prisma } from "@/lib/db";
import { cancelAppointment } from "@/server/booking/appointment-changes";
import { resetGoogleTokenCache } from "@/server/calendar/google-auth";

/**
 * A cancelled appointment must leave the calendar.
 *
 * Found by reading the code after a live SMS test: cancelAppointment marked the
 * row CANCELLED and freed the slot, and never touched Google. Our database said
 * cancelled, the customer had been told it was cancelled, and the visit stayed
 * on the technician's calendar - so someone drives out to a house that called
 * it off. That is worse than never booking: it costs a journey rather than an
 * opportunity.
 *
 * The calendar is faked here rather than reached. tests/setup.ts cuts the suite
 * off from Google for good reason, so these specs install their own fetch and
 * assert on the requests made.
 */

const ORIGINAL = { ...process.env };

let seq = 0;
async function seedBookedLead(calendarEventId: string | null) {
  seq += 1;

  const lead = await prisma.lead.create({
    data: {
      name: `Cancel Test ${seq}`,
      phone: `+1555900${String(seq).padStart(4, "0")}`,
      serviceAddress: "1 Test Street",
      initialMessage: "No cooling.",
      dedupeKey: `cancel-cal-${seq}-${Date.now()}-${Math.random()}`,
      smsConsentAt: new Date(),
      status: "BOOKED",
    },
  });

  const at = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const appointment = await prisma.appointment.create({
    data: {
      leadId: lead.id,
      slotLabel: "Mon-Fri 9am",
      slotKey: `${at.toISOString().slice(0, 10)}|mon-fri 9am|${seq}`,
      scheduledAt: at,
      scheduledEndAt: new Date(at.getTime() + 90 * 60 * 1000),
      durationMinutes: 90,
      calendarEventId,
    },
  });

  return { lead, appointment };
}

/** Records every request, answers the token endpoint, and lets specs set the delete status. */
function installFetchDouble(deleteStatus: number) {
  const calls: Array<{ method: string; url: string }> = [];

  vi.stubGlobal("fetch", async (input: unknown, init?: { method?: string }) => {
    const url = String(input);
    calls.push({ method: init?.method ?? "GET", url });

    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // null, not "": constructing a 204 with a body throws, which the code
    // under test then catches as a failed deletion - the double would have
    // reported a bug that only existed in the double.
    return new Response(null, { status: deleteStatus });
  });

  return calls;
}

/**
 * A real RSA key, generated here rather than pasted.
 *
 * A dummy string passes the env schema and then fails inside createSign, which
 * returns from deleteCalendarEvent before any HTTP call is made - so the specs
 * saw "no DELETE issued" and one of them passed for entirely the wrong reason.
 * Generating a genuine key exercises the signing path instead of skipping it.
 */
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

beforeEach(() => {
  // Credentials only for these specs, so the calendar path is reachable at all.
  process.env.GOOGLE_CLIENT_EMAIL = "svc@example.iam.gserviceaccount.com";
  process.env.GOOGLE_PRIVATE_KEY = privateKey;
  process.env.GOOGLE_CALENDAR_ID = "business@example.com";
  resetEnvCache();
  resetGoogleTokenCache();
});

/*
 * Restore only the keys this file sets. Replacing process.env wholesale
 * discards anything a later hook added, and leaks whatever this file left
 * behind into the next - a lesson from schedule-queries, where a stray
 * timezone put a different suite inside quiet hours.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ["GOOGLE_CLIENT_EMAIL", "GOOGLE_PRIVATE_KEY", "GOOGLE_CALENDAR_ID"]) {
    if (ORIGINAL[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL[key];
  }
  resetEnvCache();
  resetGoogleTokenCache();
});

describe("cancelling removes the calendar event", () => {
  it("issues a DELETE for the event and clears the stored id", async () => {
    const calls = installFetchDouble(204);
    const { lead, appointment } = await seedBookedLead("evt-abc123");

    const cancelled = await cancelAppointment(lead);

    expect(cancelled?.status).toBe("CANCELLED");

    const deletes = calls.filter((c) => c.method === "DELETE");
    expect(deletes).toHaveLength(1);
    // The right event on the right calendar - not merely "a request was made".
    expect(deletes[0].url).toContain("evt-abc123");
    expect(deletes[0].url).toContain(encodeURIComponent("business@example.com"));

    const stored = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(stored.calendarEventId).toBeNull();
  });

  it("treats an already-deleted event as removed", async () => {
    // Google answers 410 for an event deleted twice. Nothing is on anyone's
    // calendar, which is the outcome asked for - retrying forever would not be.
    installFetchDouble(410);
    const { lead, appointment } = await seedBookedLead("evt-gone");

    await cancelAppointment(lead);

    const stored = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(stored.calendarEventId).toBeNull();
  });

  it("keeps the event id when the removal fails, so it can be retried", async () => {
    installFetchDouble(500);
    const { lead, appointment } = await seedBookedLead("evt-stuck");

    const cancelled = await cancelAppointment(lead);

    // The cancellation still stands - a calendar outage must not resurrect a
    // visit the customer called off.
    expect(cancelled?.status).toBe("CANCELLED");

    // But the id survives, because the event is still out there and the row is
    // the only record of which one it is.
    const stored = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(stored.calendarEventId).toBe("evt-stuck");
  });

  it("cancels normally when there is no calendar event", async () => {
    const calls = installFetchDouble(204);
    const { lead } = await seedBookedLead(null);

    const cancelled = await cancelAppointment(lead);

    expect(cancelled?.status).toBe("CANCELLED");
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
  });
});
