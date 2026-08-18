import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getEnv, resetEnvCache } from "@/config/env";

const ORIGINAL = { ...process.env };

/**
 * Every default must satisfy its own schema.
 *
 * SERVICE_AREA carried `.min(1).default("")` - the default failed the rule,
 * so a fresh clone that supplied only DATABASE_URL could not start, and the
 * error named a variable nobody had touched. Local development never saw it
 * because .env happened to set the value.
 */
describe("configuration defaults", () => {
  beforeEach(() => {
    // The true minimum a deployment must supply. Everything else has to
    // default to something the schema itself accepts.
    //
    // The AI key belongs here rather than being a defaulting failure: an
    // assistant cannot converse without one, so requiring it is a real
    // dependency. SERVICE_AREA was different - it carried a rule its own
    // default broke, which is a bug rather than a requirement.
    process.env = {
      NODE_ENV: "test",
      DATABASE_URL: ORIGINAL.DATABASE_URL,
      LEAD_WEBHOOK_SECRET: "0123456789abcdef0123",
      BUSINESS_NAME: "Defaults Test Co",
      BUSINESS_COUNTRY_CODE: "+1",
      OPENAI_API_KEY: "sk-not-a-real-key-tests-never-call-out",
    } as NodeJS.ProcessEnv;
    resetEnvCache();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
    resetEnvCache();
  });

  it("validates with only the five mandatory variables set", () => {
    // If this fails, a fresh clone cannot start, and the error will name a
    // variable whoever cloned it has never heard of.
    expect(() => getEnv()).not.toThrow();
  });

  it("treats an unset service area as 'not configured' rather than invalid", () => {
    expect(getEnv().SERVICE_AREA).toBe("");
  });

  it("supplies a usable default for every optional key", () => {
    const env = getEnv();

    // Spot-check the ones a deployment is most likely to leave alone.
    expect(env.SMS_PROVIDER).toBe("console");
    expect(env.BOOKING_MODE).toBe("fixed");
    expect(env.DASHBOARD_SESSION_HOURS).toBeGreaterThan(0);
    expect(env.SMS_INTRO_TEMPLATE.length).toBeGreaterThan(0);
    expect(env.SMS_HELP_TEMPLATE).toContain("STOP");
  });
});
