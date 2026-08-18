import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetEnvCache } from "@/config/env";
import { prisma } from "@/lib/db";
import { getDashboardMetrics, getStalledLeads } from "@/server/analytics/metrics-service";

/**
 * Business hours are pinned here rather than inherited from .env: the
 * after-hours assertion is only meaningful against a known schedule, and a
 * client changing their opening times must not turn this suite red.
 */
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.BUSINESS_TIMEZONE = "America/Chicago";
  process.env.BUSINESS_OPEN_HOUR = "8";
  process.env.BUSINESS_CLOSE_HOUR = "18";
  process.env.BUSINESS_OPEN_DAYS = "1,2,3,4,5,6";
  resetEnvCache();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetEnvCache();
});

let leadCounter = 0;

async function createLead(overrides: {
  createdAt: Date;
  introSmsSentAt?: Date | null;
  smsOptedOutAt?: Date | null;
  name?: string;
}) {
  leadCounter += 1;

  return prisma.lead.create({
    data: {
      name: overrides.name ?? `Lead ${leadCounter}`,
      phone: `+1555000${String(leadCounter).padStart(4, "0")}`,
      serviceAddress: "1 Test Street",
      initialMessage: "No heat upstairs.",
      dedupeKey: `dedupe-${leadCounter}-${Date.now()}`,
      createdAt: overrides.createdAt,
      introSmsSentAt: overrides.introSmsSentAt ?? null,
      smsOptedOutAt: overrides.smsOptedOutAt ?? null,
    },
  });
}

describe("getDashboardMetrics", () => {
  it("reports zeroes and nulls on an empty database rather than throwing", async () => {
    const metrics = await getDashboardMetrics(30, new Date("2026-03-10T15:00:00Z"));

    expect(metrics.leadsReceived).toBe(0);
    expect(metrics.appointmentsBooked).toBe(0);
    expect(metrics.bookingRatePercent).toBe(0);
    // Null, not zero: "nothing measured" and "instant" are different claims.
    expect(metrics.medianResponseSeconds).toBeNull();
    expect(metrics.slowestResponseSeconds).toBeNull();
  });

  it("computes the median response time, not the mean", async () => {
    const now = new Date("2026-03-10T15:00:00Z");
    const base = new Date("2026-03-10T12:00:00Z");

    // 30s, 60s, and a badly stranded 2h. The mean would be ~41 minutes; the
    // median describes the customer's actual experience.
    for (const seconds of [30, 60, 7200]) {
      await createLead({
        createdAt: base,
        introSmsSentAt: new Date(base.getTime() + seconds * 1000),
      });
    }

    const metrics = await getDashboardMetrics(30, now);

    expect(metrics.medianResponseSeconds).toBe(60);
    expect(metrics.slowestResponseSeconds).toBe(7200);
    expect(metrics.leadsContacted).toBe(3);
  });

  it("averages the middle pair when the count is even", async () => {
    const now = new Date("2026-03-10T15:00:00Z");
    const base = new Date("2026-03-10T12:00:00Z");

    for (const seconds of [10, 20, 40, 80]) {
      await createLead({
        createdAt: base,
        introSmsSentAt: new Date(base.getTime() + seconds * 1000),
      });
    }

    const metrics = await getDashboardMetrics(30, now);

    expect(metrics.medianResponseSeconds).toBe(30);
  });

  it("excludes leads that never received an intro SMS from the response time", async () => {
    const now = new Date("2026-03-10T15:00:00Z");
    const base = new Date("2026-03-10T12:00:00Z");

    await createLead({
      createdAt: base,
      introSmsSentAt: new Date(base.getTime() + 45_000),
    });
    await createLead({ createdAt: base, introSmsSentAt: null });

    const metrics = await getDashboardMetrics(30, now);

    // The stranded lead must not be counted as a 0-second response - that
    // would make the headline metric look better the more customers were
    // ignored.
    expect(metrics.medianResponseSeconds).toBe(45);
    expect(metrics.leadsReceived).toBe(2);
    expect(metrics.leadsContacted).toBe(1);
    expect(metrics.leadsAwaitingFirstContact).toBe(1);
  });

  it("counts bookings made outside business hours separately", async () => {
    const now = new Date("2026-03-12T20:00:00Z");
    const lead = await createLead({ createdAt: new Date("2026-03-10T12:00:00Z") });

    // 2026-03-10 is a Tuesday. 14:00 UTC is 09:00 in Chicago (open);
    // 07:00 UTC is 01:00 (closed).
    const midday = new Date("2026-03-10T14:00:00Z");
    const smallHours = new Date("2026-03-10T07:00:00Z");

    await prisma.appointment.create({
      data: {
        leadId: lead.id,
        slotLabel: "Tue 9am-11am",
        durationMinutes: 120,
        slotKey: "slot-open",
        createdAt: midday,
      },
    });
    await prisma.appointment.create({
      data: {
        leadId: lead.id,
        slotLabel: "Wed 1pm-3pm",
        durationMinutes: 120,
        slotKey: "slot-afterhours",
        createdAt: smallHours,
      },
    });

    const metrics = await getDashboardMetrics(30, now);

    expect(metrics.appointmentsBooked).toBe(2);
    // The product goal is capturing bookings nobody would have answered the
    // phone for; if this ever reads 0 while bookings exist, that goal is
    // silently unmet.
    expect(metrics.afterHoursBookings).toBe(1);
  });

  it("counts a Sunday booking as after hours even at midday", async () => {
    const now = new Date("2026-03-16T20:00:00Z");
    const lead = await createLead({ createdAt: new Date("2026-03-14T12:00:00Z") });

    // 2026-03-15 is a Sunday, and day 7 is not in the configured open days.
    await prisma.appointment.create({
      data: {
        leadId: lead.id,
        slotLabel: "Sun 10am-12pm",
        durationMinutes: 120,
        slotKey: "slot-sunday",
        createdAt: new Date("2026-03-15T15:00:00Z"),
      },
    });

    const metrics = await getDashboardMetrics(30, now);

    expect(metrics.afterHoursBookings).toBe(1);
  });

  it("expresses the booking rate as a percentage of leads received", async () => {
    const now = new Date("2026-03-10T15:00:00Z");
    const created = new Date("2026-03-09T12:00:00Z");

    const leads = [];
    for (let index = 0; index < 8; index += 1) {
      leads.push(await createLead({ createdAt: created }));
    }

    for (let index = 0; index < 3; index += 1) {
      await prisma.appointment.create({
        data: {
          leadId: leads[index].id,
          slotLabel: `Slot ${index}`,
          durationMinutes: 120,
          slotKey: `rate-slot-${index}`,
          createdAt: created,
        },
      });
    }

    const metrics = await getDashboardMetrics(30, now);

    expect(metrics.leadsReceived).toBe(8);
    expect(metrics.appointmentsBooked).toBe(3);
    expect(metrics.bookingRatePercent).toBe(37.5);
  });

  it("ignores leads that fall outside the window", async () => {
    const now = new Date("2026-03-10T15:00:00Z");

    await createLead({ createdAt: new Date("2026-03-09T12:00:00Z") });
    await createLead({ createdAt: new Date("2026-01-01T12:00:00Z") });

    const metrics = await getDashboardMetrics(30, now);

    expect(metrics.leadsReceived).toBe(1);
    expect(metrics.windowDays).toBe(30);
  });

  it("counts messages by direction", async () => {
    const now = new Date("2026-03-10T15:00:00Z");
    const lead = await createLead({ createdAt: new Date("2026-03-09T12:00:00Z") });
    const at = new Date("2026-03-09T12:05:00Z");

    await prisma.message.createMany({
      data: [
        { leadId: lead.id, direction: "OUTBOUND", phone: lead.phone, body: "Hi", provider: "test", createdAt: at },
        { leadId: lead.id, direction: "OUTBOUND", phone: lead.phone, body: "Still there?", provider: "test", createdAt: at },
        { leadId: lead.id, direction: "INBOUND", phone: lead.phone, body: "Yes", provider: "test", createdAt: at },
      ],
    });

    const metrics = await getDashboardMetrics(30, now);

    expect(metrics.messagesSent).toBe(2);
    expect(metrics.messagesReceived).toBe(1);
  });

  it("counts opt-outs that happened inside the window", async () => {
    const now = new Date("2026-03-10T15:00:00Z");

    await createLead({
      createdAt: new Date("2026-03-09T12:00:00Z"),
      smsOptedOutAt: new Date("2026-03-09T13:00:00Z"),
    });
    await createLead({ createdAt: new Date("2026-03-09T12:00:00Z") });

    const metrics = await getDashboardMetrics(30, now);

    expect(metrics.optOuts).toBe(1);
  });
});

describe("getStalledLeads", () => {
  it("returns leads never texted, oldest first, with how long they have waited", async () => {
    const now = new Date("2026-03-10T15:00:00Z");

    await createLead({
      name: "Recent",
      createdAt: new Date("2026-03-10T14:00:00Z"),
      introSmsSentAt: null,
    });
    await createLead({
      name: "Ancient",
      createdAt: new Date("2026-03-08T15:00:00Z"),
      introSmsSentAt: null,
    });

    const stalled = await getStalledLeads(5, now);

    expect(stalled.map((lead) => lead.name)).toEqual(["Ancient", "Recent"]);
    expect(stalled[0].waitingSeconds).toBe(2 * 24 * 60 * 60);
    expect(stalled[1].waitingSeconds).toBe(60 * 60);
  });

  it("excludes leads that were contacted or opted out", async () => {
    const now = new Date("2026-03-10T15:00:00Z");
    const created = new Date("2026-03-09T12:00:00Z");

    await createLead({ name: "Contacted", createdAt: created, introSmsSentAt: created });
    await createLead({ name: "Opted out", createdAt: created, smsOptedOutAt: created });
    await createLead({ name: "Genuinely waiting", createdAt: created });

    const stalled = await getStalledLeads(5, now);

    // Texting someone who sent STOP is the one thing this queue must never
    // cause, so they are excluded here as well as at send time.
    expect(stalled.map((lead) => lead.name)).toEqual(["Genuinely waiting"]);
  });

  it("looks past the metrics window, because an older stranded lead is more urgent", async () => {
    const now = new Date("2026-03-10T15:00:00Z");

    await createLead({ name: "Stranded in January", createdAt: new Date("2026-01-02T12:00:00Z") });

    const stalled = await getStalledLeads(5, now);

    expect(stalled).toHaveLength(1);
    expect(stalled[0].name).toBe("Stranded in January");
  });
});
