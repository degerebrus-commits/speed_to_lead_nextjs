import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetEnvCache } from "@/config/env";
import { prisma } from "@/lib/db";
import { getSchedule } from "@/server/booking/schedule-queries";

/**
 * The dashboard's week of visits.
 *
 * The part worth testing hardest is the grouping. Appointments are stored as
 * UTC instants and displayed against the business's own calendar, and for eight
 * months of the year a 9am Manila visit falls on the previous UTC day. Grouping
 * on the wrong one puts a job on Tuesday that the owner knows is on Wednesday.
 */

/**
 * Pinned, not inherited.
 *
 * These specs assert that a particular instant lands on a particular date, and
 * that claim only means something against a known offset. Reading the ambient
 * BUSINESS_TIMEZONE instead would make them pass or fail depending on whoever
 * last edited .env - the configuration equivalent of the real-clock trap in
 * MISTAKES.md.
 *
 * The query itself hardcodes nothing; it asks getBusinessProfile(). The last
 * spec here proves that by running the same instant through two different
 * configured zones and getting two different days.
 */
const MANILA = "Asia/Manila";

const ORIGINAL_TIMEZONE = process.env.BUSINESS_TIMEZONE;

beforeEach(() => {
  process.env.BUSINESS_TIMEZONE = MANILA;
  resetEnvCache();
});

/*
 * Restore the single key this file touches, rather than replacing process.env
 * wholesale. Without this the last spec left BUSINESS_TIMEZONE on Chicago, and
 * a later file sending intro texts found itself inside quiet hours - five
 * failures in a suite where every one of these specs passed alone.
 */
afterEach(() => {
  if (ORIGINAL_TIMEZONE === undefined) delete process.env.BUSINESS_TIMEZONE;
  else process.env.BUSINESS_TIMEZONE = ORIGINAL_TIMEZONE;
  resetEnvCache();
});

let seq = 0;

async function bookVisit(
  scheduledAt: Date | null,
  options: { optedOut?: boolean; status?: "CONFIRMED" | "CANCELLED"; name?: string } = {},
) {
  seq += 1;

  const lead = await prisma.lead.create({
    data: {
      name: options.name ?? `Visitor ${seq}`,
      phone: `+63917000${String(seq).padStart(4, "0")}`,
      serviceAddress: `${seq} Test Street`,
      initialMessage: "No cooling.",
      dedupeKey: `sched-${seq}-${Date.now()}-${Math.random()}`,
      smsConsentAt: new Date(),
      smsOptedOutAt: options.optedOut ? new Date() : null,
    },
  });

  return prisma.appointment.create({
    data: {
      leadId: lead.id,
      slotLabel: "Mon-Fri 9am",
      slotKey: `sched-key-${seq}-${Date.now()}`,
      scheduledAt,
      scheduledEndAt:
        scheduledAt === null ? null : new Date(scheduledAt.getTime() + 90 * 60 * 1000),
      durationMinutes: 90,
      status: options.status ?? "CONFIRMED",
    },
  });
}

describe("getSchedule", () => {
  it("groups a visit by the business's day, not the UTC one", async () => {
    // 20 Aug 01:00Z is 20 Aug 09:00 in Manila. Same date here, so this pins the
    // ordinary case before the interesting one below.
    await bookVisit(new Date("2026-08-20T01:00:00.000Z"), { name: "Morning" });

    const days = await getSchedule(7, new Date("2026-08-20T02:00:00.000Z"));

    expect(days[0].visits.map((v) => v.name)).toEqual(["Morning"]);
  });

  it("puts a late-evening Manila visit on the Manila day", async () => {
    // 20 Aug 14:00Z is 20 Aug 22:00 in Manila but would be the 20th in UTC too.
    // 20 Aug 17:00Z is 21 Aug 01:00 Manila - a different date in each zone, and
    // the case that catches a UTC grouping.
    await bookVisit(new Date("2026-08-20T17:00:00.000Z"), { name: "Past midnight" });

    const days = await getSchedule(7, new Date("2026-08-20T02:00:00.000Z"));

    expect(days[0].visits).toHaveLength(0);
    expect(days[1].visits.map((v) => v.name)).toEqual(["Past midnight"]);
    expect(days[1].key).toBe("2026-08-21");
  });

  it("keeps this morning's visit on today's column", async () => {
    // An owner looking at the dashboard in the afternoon still wants to see the
    // morning job. The column is "today", not "what is left of today".
    await bookVisit(new Date("2026-08-20T01:00:00.000Z"), { name: "Already done" });

    const days = await getSchedule(7, new Date("2026-08-20T08:00:00.000Z"));

    expect(days[0].visits.map((v) => v.name)).toEqual(["Already done"]);
  });

  it("returns every day, including the empty ones", async () => {
    await bookVisit(new Date("2026-08-22T01:00:00.000Z"));

    const days = await getSchedule(7, new Date("2026-08-20T02:00:00.000Z"));

    expect(days).toHaveLength(7);
    expect(days.map((d) => d.key)).toEqual([
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
      "2026-08-23",
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
    ]);
    expect(days[1].visits).toHaveLength(0);
  });

  it("marks today and nothing else", async () => {
    const days = await getSchedule(7, new Date("2026-08-20T02:00:00.000Z"));

    expect(days.filter((d) => d.isToday).map((d) => d.key)).toEqual(["2026-08-20"]);
  });

  it("omits cancelled visits", async () => {
    await bookVisit(new Date("2026-08-20T01:00:00.000Z"), {
      status: "CANCELLED",
      name: "Called off",
    });

    const days = await getSchedule(7, new Date("2026-08-20T02:00:00.000Z"));

    expect(days.flatMap((d) => d.visits)).toHaveLength(0);
  });

  it("flags a booked customer who has opted out", async () => {
    // The visit stands and the assistant can no longer reach them. This is the
    // case that needs a person to pick up the phone, and it is invisible unless
    // the card says so.
    await bookVisit(new Date("2026-08-20T01:00:00.000Z"), {
      optedOut: true,
      name: "Unreachable",
    });
    await bookVisit(new Date("2026-08-20T03:00:00.000Z"), { name: "Reachable" });

    const days = await getSchedule(7, new Date("2026-08-20T02:00:00.000Z"));

    expect(days[0].visits.map((v) => [v.name, v.optedOut])).toEqual([
      ["Unreachable", true],
      ["Reachable", false],
    ]);
  });

  it("orders a day's visits by time", async () => {
    await bookVisit(new Date("2026-08-20T06:00:00.000Z"), { name: "Afternoon" });
    await bookVisit(new Date("2026-08-20T01:00:00.000Z"), { name: "Morning" });

    const days = await getSchedule(7, new Date("2026-08-20T00:30:00.000Z"));

    expect(days[0].visits.map((v) => v.name)).toEqual(["Morning", "Afternoon"]);
  });

  it("groups by whichever timezone the business is configured for", async () => {
    // One instant, two businesses. 20 Aug 17:00Z is already the 21st in Manila
    // and still the 20th in Chicago, and the query knows about neither - it
    // asks the profile. This is what stops the Philippines test configuration
    // from quietly becoming a Philippines assumption when the client is in
    // Texas.
    await bookVisit(new Date("2026-08-20T17:00:00.000Z"), { name: "Same instant" });

    const at = new Date("2026-08-20T02:00:00.000Z");

    process.env.BUSINESS_TIMEZONE = "Asia/Manila";
    resetEnvCache();
    const manila = await getSchedule(7, at);

    process.env.BUSINESS_TIMEZONE = "America/Chicago";
    resetEnvCache();
    const chicago = await getSchedule(7, at);

    const dayHolding = (days: Awaited<ReturnType<typeof getSchedule>>) =>
      days.find((d) => d.visits.some((v) => v.name === "Same instant"))?.key;

    expect(dayHolding(manila)).toBe("2026-08-21");
    expect(dayHolding(chicago)).toBe("2026-08-20");
  });

  it("carries what the card and the link need", async () => {
    await bookVisit(new Date("2026-08-20T01:00:00.000Z"), { name: "Ramon Cruz" });

    const [visit] = (await getSchedule(7, new Date("2026-08-20T02:00:00.000Z")))[0].visits;

    expect(visit.name).toBe("Ramon Cruz");
    expect(visit.phone).toMatch(/^\+63917/);
    expect(visit.serviceAddress).toContain("Test Street");
    // The card links to the lead, not the appointment - the conversation is
    // what an owner wants when they tap a name.
    expect(visit.leadId).toBeTruthy();
  });
});
