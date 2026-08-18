import { describe, expect, it } from "vitest";

import {
  buildScheduledSlotKey,
  parseSlotLabel,
  resolveNextOccurrence,
} from "@/server/booking/slot-schedule";

const CHICAGO = "America/Chicago";

/** What a resolved instant reads as on the business's wall clock. */
function chicagoWallClock(instant: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
}

describe("parseSlotLabel", () => {
  it("parses a weekday range", () => {
    expect(parseSlotLabel("Mon-Fri 9am")).toEqual({
      weekdays: [1, 2, 3, 4, 5],
      hour: 9,
      minute: 0,
    });
  });

  it("parses a single day", () => {
    expect(parseSlotLabel("Sat 10am")).toEqual({ weekdays: [6], hour: 10, minute: 0 });
  });

  it("converts the 12-hour clock correctly at both noon and midnight", () => {
    expect(parseSlotLabel("Mon 12pm")?.hour).toBe(12);
    expect(parseSlotLabel("Mon 12am")?.hour).toBe(0);
    expect(parseSlotLabel("Mon 2pm")?.hour).toBe(14);
  });

  it("parses minutes when given", () => {
    expect(parseSlotLabel("Tue 2:30pm")).toEqual({ weekdays: [2], hour: 14, minute: 30 });
  });

  it("handles a range that wraps the weekend", () => {
    expect(parseSlotLabel("Sat-Mon 9am")?.weekdays).toEqual([6, 7, 1]);
  });

  it("returns null rather than guessing at an unparseable label", () => {
    for (const label of ["", "whenever", "Mon", "9am", "Xyz 9am", "Mon 25am", "Mon 9"]) {
      expect(parseSlotLabel(label), label).toBeNull();
    }
  });
});

describe("resolveNextOccurrence", () => {
  it("finds the next matching weekday", () => {
    // 2026-08-18 is a Tuesday. 12:00 UTC is 07:00 in Chicago.
    const now = new Date("2026-08-18T12:00:00Z");
    const resolved = resolveNextOccurrence("Sat 10am", now, CHICAGO);

    expect(chicagoWallClock(resolved!)).toBe("Sat, 08/22/2026, 10:00");
  });

  it("returns today when the slot is still ahead", () => {
    const now = new Date("2026-08-18T12:00:00Z"); // Tue 07:00 Chicago
    const resolved = resolveNextOccurrence("Mon-Fri 9am", now, CHICAGO);

    expect(chicagoWallClock(resolved!)).toBe("Tue, 08/18/2026, 09:00");
  });

  it("skips to tomorrow once today's slot has passed", () => {
    const now = new Date("2026-08-18T16:00:00Z"); // Tue 11:00 Chicago
    const resolved = resolveNextOccurrence("Mon-Fri 9am", now, CHICAGO);

    // Not Tuesday 9am, which is in the past.
    expect(chicagoWallClock(resolved!)).toBe("Wed, 08/19/2026, 09:00");
  });

  it("is never equal to now - a slot at 9am is not offerable at 9am", () => {
    const nineAmChicago = new Date("2026-08-18T14:00:00Z");
    const resolved = resolveNextOccurrence("Mon-Fri 9am", nineAmChicago, CHICAGO);

    expect(resolved!.getTime()).toBeGreaterThan(nineAmChicago.getTime());
  });

  it("lands on the right wall-clock hour across a daylight-saving change", () => {
    // US DST ends 2026-11-01. A slot before and after must both read 9am
    // locally, even though the UTC offset differs.
    const before = resolveNextOccurrence("Mon-Fri 9am", new Date("2026-10-27T12:00:00Z"), CHICAGO);
    const after = resolveNextOccurrence("Mon-Fri 9am", new Date("2026-11-03T13:00:00Z"), CHICAGO);

    expect(chicagoWallClock(before!)).toContain("09:00");
    expect(chicagoWallClock(after!)).toContain("09:00");

    // And the offsets genuinely differ, or this test proves nothing.
    expect(before!.getUTCHours()).not.toBe(after!.getUTCHours());
  });

  it("returns null for a label it cannot parse", () => {
    expect(resolveNextOccurrence("sometime next week", new Date(), CHICAGO)).toBeNull();
  });
});

describe("buildScheduledSlotKey", () => {
  it("includes the date, so the same slot is bookable next week", () => {
    const first = buildScheduledSlotKey("Mon-Fri 9am", new Date("2026-08-18T14:00:00Z"));
    const nextWeek = buildScheduledSlotKey("Mon-Fri 9am", new Date("2026-08-25T14:00:00Z"));

    // The bug this fixes: keyed on the label alone these collided, so six
    // configured slots meant six bookings ever.
    expect(first).not.toBe(nextWeek);
    expect(first).toContain("2026-08-18");
  });

  it("normalises case and spacing so a label variant cannot double-book", () => {
    const at = new Date("2026-08-18T14:00:00Z");

    expect(buildScheduledSlotKey("Mon-Fri  9AM", at)).toBe(buildScheduledSlotKey("mon-fri 9am", at));
  });

  it("falls back to the label alone when there is no timestamp", () => {
    // Unbookable twice is better than double-booked.
    expect(buildScheduledSlotKey("Mon-Fri 9am", null)).toBe("mon-fri 9am");
  });
});
