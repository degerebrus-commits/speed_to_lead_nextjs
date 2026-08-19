import { describe, expect, it } from "vitest";

import { getEnv } from "@/config/env";
import { isCalendarConfigured } from "@/server/calendar/calendar-service";

/**
 * The suite must never reach Google.
 *
 * This exists because it already happened. .env carries a real service
 * account, and tests/setup.ts originally cleared it at module scope - which
 * does not hold, because vitest loads .env through Vite after setup modules
 * are evaluated. Every booking spec was making live Calendar API calls, and
 * the business's real events filtered availability down to nothing. Three
 * specs failed on what looked like a slot-resolution bug.
 *
 * Guarded here rather than trusted, because the failure is silent: a suite
 * that talks to the network still passes, right up until the network or the
 * calendar's contents change.
 */
describe("test network isolation", () => {
  it("has no Google credentials in scope", () => {
    const env = getEnv();

    expect(env.GOOGLE_CLIENT_EMAIL).toBeUndefined();
    expect(env.GOOGLE_PRIVATE_KEY).toBeUndefined();
    expect(env.GOOGLE_CALENDAR_ID).toBeUndefined();
  });

  it("reports the calendar as unconfigured, so no lookup is attempted", () => {
    expect(isCalendarConfigured()).toBe(false);
  });
});
