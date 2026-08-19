import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getEnv, resetEnvCache } from "@/config/env";

const ORIGINAL = { ...process.env };

/**
 * Everything that must have a working default. Deleted before each case so the
 * schema is exercised on its defaults rather than on whatever .env supplies.
 */
const OPTIONAL_KEYS = [
  "SERVICE_AREA",
  "REP_NAME",
  "BUSINESS_TIMEZONE",
  "BUSINESS_HOURS",
  "BUSINESS_OPEN_HOUR",
  "BUSINESS_CLOSE_HOUR",
  "BUSINESS_OPEN_DAYS",
  "OWNER_PHONE",
  "SMS_PROVIDER",
  "SMS_INTRO_TEMPLATE",
  "SMS_MONTHLY_LIMIT",
  "BOOKING_MODE",
  "AVAILABLE_TIME_SLOTS",
  "APPOINTMENT_DURATION_MINUTES",
  "DASHBOARD_PASSWORD",
  "DASHBOARD_SESSION_SECRET",
  "DASHBOARD_SESSION_HOURS",
  "DEMO_FORM_ENABLED",
  "TRUSTED_PROXY",
  "TEXTBEE_API_KEY",
  "TEXTBEE_DEVICE_ID",
  "TEXTBEE_WEBHOOK_SECRET",
  "ANTHROPIC_API_KEY",
];

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
    // Deletes the optional keys rather than replacing process.env wholesale.
    //
    // vitest runs every file in one fork here (the suite shares a Postgres and
    // truncates between cases), so process.env is global to the whole run.
    // Swapping the object out left other files' module-level snapshots holding
    // a stripped copy, depending on import order - which showed up as one
    // failure in roughly every three runs, in a different file each time.
    for (const key of OPTIONAL_KEYS) delete process.env[key];

    // NODE_ENV is readonly in the type but already "test" under vitest.
    process.env.DATABASE_URL = ORIGINAL.DATABASE_URL;
    process.env.LEAD_WEBHOOK_SECRET = "0123456789abcdef0123";
    process.env.BUSINESS_NAME = "Defaults Test Co";
    process.env.BUSINESS_COUNTRY_CODE = "+1";
    // A real dependency, not a defaulting failure: an assistant cannot converse
    // without an AI key. SERVICE_AREA was different - it carried a rule its own
    // default broke, which is a bug.
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-not-a-real-key-tests-never-call-out";

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

/**
 * The bug this guards: .env.example ships genuinely optional keys as `KEY=""`
 * so their existence is visible, and dotenv hands those through as empty
 * strings. Zod's `.url()` and `.min(1)` reject an empty string exactly as they
 * reject a wrong one, so a deployment that copied the example verbatim could
 * not start - and the error named a key the person had deliberately left blank.
 *
 * Reads the real file rather than a hand-written list, so it keeps testing the
 * thing that ships even as keys are added.
 */
describe("the shipped .env.example actually starts the app", () => {
  function loadExample(): Record<string, string> {
    const text = readFileSync(".env.example", "utf8");
    const parsed: Record<string, string> = {};

    for (const line of text.split(String.fromCharCode(10))) {
      const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (!match) continue;
      parsed[match[1]] = match[2].trim().replace(/^"|"$/g, "");
    }

    return parsed;
  }

  beforeEach(() => {
    for (const [key, value] of Object.entries(loadExample())) {
      process.env[key] = value;
    }

    // The example points at the default Postgres port and carries placeholder
    // credentials; the five mandatory values are what a real deployment fills
    // in, so supply those and leave everything else exactly as shipped.
    process.env.DATABASE_URL = ORIGINAL.DATABASE_URL;
    process.env.LEAD_WEBHOOK_SECRET = "0123456789abcdef0123";
    process.env.BUSINESS_NAME = "Defaults Test Co";
    process.env.BUSINESS_COUNTRY_CODE = "+1";
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-not-a-real-key";
    resetEnvCache();
  });

  it("validates with the file exactly as shipped", () => {
    expect(() => getEnv()).not.toThrow();
  });

  it("treats a blank optional value as unset rather than as a value", () => {
    // Not "" - undefined. The dashboard checks for undefined to decide whether
    // it may serve at all, and "" would read as configured.
    expect(getEnv().DASHBOARD_PASSWORD).toBeUndefined();
    expect(getEnv().SMS_GATE_URL).toBeUndefined();
    expect(getEnv().OWNER_PHONE).toBeUndefined();
  });
});
