import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getEnv, resetEnvCache } from "@/config/env";

/**
 * Every E.164 pattern in the env schema must accept a real phone number.
 *
 * `TWILIO_FROM_NUMBER` carried `/^[+][1-9]d{7,14}$/` - a literal `d` where
 * `\d` was meant, so it demanded the letter d repeated seven to fourteen
 * times and rejected every real number. It never fired because nobody had
 * configured Twilio yet; the first client deployment would have failed to
 * start with "must be E.164" against a number that plainly was.
 *
 * A dropped backslash is the third escape-sequence bug recorded here, and the
 * only reason this one surfaced is that a person read the line. So the schema
 * is exercised rather than inspected.
 */

const ORIGINAL = { ...process.env };

const PHONE_KEYS = ["TWILIO_FROM_NUMBER", "OWNER_PHONE"] as const;

beforeEach(() => resetEnvCache());

afterEach(() => {
  for (const key of PHONE_KEYS) {
    if (ORIGINAL[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL[key];
  }
  resetEnvCache();
});

describe("E.164 validation in the env schema", () => {
  // Real numbers, one per region this project has actually used.
  const valid = ["+15551234567", "+639171234567", "+442071838750"];

  for (const key of PHONE_KEYS) {
    for (const number of valid) {
      it(`${key} accepts ${number}`, () => {
        process.env[key] = number;
        resetEnvCache();

        expect(getEnv()[key]).toBe(number);
      });
    }

    it(`${key} rejects a number that is not E.164`, () => {
      // The guard has to still guard: a pattern loose enough to accept
      // anything would pass the tests above and protect nothing.
      process.env[key] = "0917 123 4567";
      resetEnvCache();

      expect(() => getEnv()).toThrow();
    });
  }
});
