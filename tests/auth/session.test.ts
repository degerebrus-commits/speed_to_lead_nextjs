import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetEnvCache } from "@/config/env";
import {
  createSessionValue,
  isCorrectPassword,
  isDashboardConfigured,
  isValidSessionValue,
} from "@/server/auth/session";

const ORIGINAL = { ...process.env };
const PASSWORD = "correct-horse-battery-staple";

beforeEach(() => {
  process.env.DASHBOARD_PASSWORD = PASSWORD;
  delete process.env.DASHBOARD_SESSION_SECRET;
  process.env.DASHBOARD_SESSION_HOURS = "12";
  resetEnvCache();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  resetEnvCache();
});

describe("isDashboardConfigured", () => {
  it("is false when no password is set, so the dashboard fails closed", () => {
    delete process.env.DASHBOARD_PASSWORD;
    resetEnvCache();

    // The dashboard shows customer home addresses. Unconfigured must mean
    // "serve nothing", never "serve to anyone".
    expect(isDashboardConfigured()).toBe(false);
  });

  it("is true once a password is configured", () => {
    expect(isDashboardConfigured()).toBe(true);
  });
});

describe("isCorrectPassword", () => {
  it("accepts the configured password", () => {
    expect(isCorrectPassword(PASSWORD)).toBe(true);
  });

  it("rejects a wrong password, including near misses", () => {
    for (const candidate of [
      "",
      "wrong",
      PASSWORD.slice(0, -1),
      `${PASSWORD} `,
      PASSWORD.toUpperCase(),
    ]) {
      expect(isCorrectPassword(candidate), JSON.stringify(candidate)).toBe(false);
    }
  });

  it("rejects everything when no password is configured", () => {
    delete process.env.DASHBOARD_PASSWORD;
    resetEnvCache();

    // Notably including the empty string, which is what a form with no input
    // submits - that must not become a skeleton key.
    expect(isCorrectPassword("")).toBe(false);
    expect(isCorrectPassword(PASSWORD)).toBe(false);
  });
});

describe("session cookies", () => {
  it("accepts a session it just issued", () => {
    expect(isValidSessionValue(createSessionValue())).toBe(true);
  });

  it("rejects a tampered expiry", () => {
    const value = createSessionValue();
    const [, signature] = value.split(".");

    // Extending your own session by editing the cookie must fail: the expiry
    // is inside what was signed.
    const forged = `${Date.now() + 10 * 365 * 24 * 60 * 60 * 1000}.${signature}`;
    expect(isValidSessionValue(forged)).toBe(false);
  });

  it("rejects a session signed with a different secret", () => {
    const value = createSessionValue();

    process.env.DASHBOARD_SESSION_SECRET = "a-completely-different-secret-value";
    resetEnvCache();

    // Rotating the secret invalidates outstanding sessions, which is the point
    // of having it separate from the password.
    expect(isValidSessionValue(value)).toBe(false);
  });

  it("rejects an expired session", () => {
    const issuedAt = new Date("2026-03-01T09:00:00Z");
    const value = createSessionValue(issuedAt);

    const withinWindow = new Date("2026-03-01T20:00:00Z");
    const afterWindow = new Date("2026-03-01T22:00:00Z");

    expect(isValidSessionValue(value, withinWindow)).toBe(true);
    expect(isValidSessionValue(value, afterWindow)).toBe(false);
  });

  it("rejects malformed values rather than throwing", () => {
    for (const value of [
      undefined,
      "",
      "no-separator",
      ".",
      ".onlysignature",
      "onlypayload.",
      "not-a-number.deadbeef",
    ]) {
      expect(() => isValidSessionValue(value), String(value)).not.toThrow();
      expect(isValidSessionValue(value), String(value)).toBe(false);
    }
  });

  it("honours a configured session length", () => {
    process.env.DASHBOARD_SESSION_HOURS = "1";
    resetEnvCache();

    const issuedAt = new Date("2026-03-01T09:00:00Z");
    const value = createSessionValue(issuedAt);

    expect(isValidSessionValue(value, new Date("2026-03-01T09:30:00Z"))).toBe(true);
    expect(isValidSessionValue(value, new Date("2026-03-01T10:30:00Z"))).toBe(false);
  });
});
