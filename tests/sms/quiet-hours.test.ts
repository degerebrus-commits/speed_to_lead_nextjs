import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetEnvCache } from "@/config/env";
import { isQuietHour, nextSendableAt } from "@/server/sms/quiet-hours";

/**
 * Quiet hours on the unsolicited first text.
 *
 * The timezone is pinned rather than inherited: asserting that 3am is quiet
 * means nothing unless it is known whose 3am. The last spec proves the code
 * itself holds no assumption, by running one instant through two zones.
 */

const ORIGINAL = { ...process.env };

function configure(options: {
  timezone?: string;
  start?: number;
  end?: number;
  enabled?: boolean;
}) {
  process.env.BUSINESS_TIMEZONE = options.timezone ?? "Asia/Manila";
  process.env.QUIET_HOURS_START = String(options.start ?? 21);
  process.env.QUIET_HOURS_END = String(options.end ?? 8);
  process.env.QUIET_HOURS_ENABLED = String(options.enabled ?? true);
  resetEnvCache();
}

beforeEach(() => configure({}));

afterEach(() => {
  for (const key of [
    "BUSINESS_TIMEZONE",
    "QUIET_HOURS_START",
    "QUIET_HOURS_END",
    "QUIET_HOURS_ENABLED",
  ]) {
    if (ORIGINAL[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL[key];
  }
  resetEnvCache();
});

/** An instant that reads as the given Manila hour. Manila is UTC+8, no DST. */
const manilaAt = (hour: number) =>
  new Date(Date.UTC(2026, 7, 20, (hour - 8 + 24) % 24, 0, 0));

describe("isQuietHour", () => {
  it("treats the middle of the night as quiet", () => {
    expect(isQuietHour(manilaAt(3))).toBe(true);
  });

  it("treats the working day as sendable", () => {
    expect(isQuietHour(manilaAt(14))).toBe(false);
  });

  it("closes at the start hour and opens at the end hour", () => {
    // The boundaries are the whole point: 21:00 is already quiet, 08:00 is
    // already open. An off-by-one here texts someone at 9pm or holds a lead an
    // hour longer than the business asked.
    expect(isQuietHour(manilaAt(20))).toBe(false);
    expect(isQuietHour(manilaAt(21))).toBe(true);
    expect(isQuietHour(manilaAt(7))).toBe(true);
    expect(isQuietHour(manilaAt(8))).toBe(false);
  });

  it("handles a window that does not wrap midnight", () => {
    // 1am to 6am. The wrapping case and this one need opposite comparisons,
    // and a single implementation that only handles the common one is wrong
    // for anybody who configures the other.
    configure({ start: 1, end: 6 });

    expect(isQuietHour(manilaAt(3))).toBe(true);
    expect(isQuietHour(manilaAt(23))).toBe(false);
    expect(isQuietHour(manilaAt(9))).toBe(false);
  });

  it("is off entirely when disabled", () => {
    configure({ enabled: false });

    expect(isQuietHour(manilaAt(3))).toBe(false);
    expect(nextSendableAt(manilaAt(3))).toBeNull();
  });
});

describe("nextSendableAt", () => {
  it("returns null outside quiet hours, so the send proceeds", () => {
    expect(nextSendableAt(manilaAt(14))).toBeNull();
  });

  it("releases a midnight lead at the opening hour", () => {
    const at = nextSendableAt(manilaAt(2));

    expect(at).not.toBeNull();
    const hour = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Manila",
      hour: "2-digit",
      hour12: false,
    }).format(at!);
    expect(Number.parseInt(hour, 10) % 24).toBe(8);
  });

  it("carries an evening lead over to the next morning", () => {
    // 22:00 on the 20th must land on the 21st, not the same morning that has
    // already passed - the bug that would text someone fourteen hours late and
    // look like it worked.
    const at = nextSendableAt(manilaAt(22))!;

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);

    expect(parts).toBe("2026-08-21");
    expect(at.getTime()).toBeGreaterThan(manilaAt(22).getTime());
  });

  it("lands on the hour rather than the minute the lead arrived", () => {
    const arrived = new Date(manilaAt(2).getTime() + 37 * 60 * 1000);
    const at = nextSendableAt(arrived)!;

    expect(at.getUTCMinutes()).toBe(0);
    expect(at.getUTCSeconds()).toBe(0);
  });

  it("asks the configured timezone, not a built-in one", () => {
    // One instant, two businesses. 2026-08-20T18:00Z is 02:00 in Manila and
    // 13:00 in Chicago: quiet for one, the middle of the working day for the
    // other. This is what stops the Philippine test configuration becoming a
    // Philippine assumption when the client is in Texas.
    const instant = new Date("2026-08-20T18:00:00.000Z");

    configure({ timezone: "Asia/Manila" });
    expect(isQuietHour(instant)).toBe(true);

    configure({ timezone: "America/Chicago" });
    expect(isQuietHour(instant)).toBe(false);
  });
});
