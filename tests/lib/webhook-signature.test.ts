import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isValidWebhookSignature, isWithinFreshnessWindow } from "@/lib/webhook-signature";

const SECRET = "a-signing-secret-of-sufficient-length";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("isValidWebhookSignature", () => {
  const body = JSON.stringify({ event: "MESSAGE_RECEIVED", data: { _id: "abc" } });

  it("accepts a signature computed over the exact raw body", () => {
    expect(isValidWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("accepts an upper-case hex digest", () => {
    expect(isValidWebhookSignature(body, sign(body).toUpperCase(), SECRET)).toBe(true);
  });

  it("rejects a body altered by even one character", () => {
    const signature = sign(body);
    const tampered = body.replace('"abc"', '"abd"');

    expect(isValidWebhookSignature(tampered, signature, SECRET)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    expect(isValidWebhookSignature(body, sign(body, "some-other-secret-entirely"), SECRET)).toBe(
      false,
    );
  });

  it("rejects a missing signature and an empty secret", () => {
    expect(isValidWebhookSignature(body, null, SECRET)).toBe(false);
    expect(isValidWebhookSignature(body, sign(body), "")).toBe(false);
  });

  it("rejects a re-serialised body with different key order", () => {
    // The reason the route hashes raw text rather than a parsed object: these
    // two JSON strings describe the same object and have different digests.
    const reordered = JSON.stringify({ data: { _id: "abc" }, event: "MESSAGE_RECEIVED" });

    expect(reordered).not.toBe(body);
    expect(isValidWebhookSignature(reordered, sign(body), SECRET)).toBe(false);
  });
});

describe("isWithinFreshnessWindow", () => {
  const now = new Date("2026-08-17T12:00:00.000Z").getTime();
  const maxAge = 5 * 60 * 1000;

  it("accepts a delivery sent moments ago", () => {
    expect(isWithinFreshnessWindow("2026-08-17T11:59:00.000Z", maxAge, now)).toBe(true);
  });

  it("rejects a delivery older than the window", () => {
    expect(isWithinFreshnessWindow("2026-08-17T11:50:00.000Z", maxAge, now)).toBe(false);
  });

  it("tolerates small clock skew into the future", () => {
    expect(isWithinFreshnessWindow("2026-08-17T12:00:30.000Z", maxAge, now)).toBe(true);
  });

  it("rejects a wildly future timestamp", () => {
    expect(isWithinFreshnessWindow("2026-08-17T13:00:00.000Z", maxAge, now)).toBe(false);
  });

  it("rejects a missing or unparseable timestamp", () => {
    expect(isWithinFreshnessWindow(undefined, maxAge, now)).toBe(false);
    expect(isWithinFreshnessWindow("not-a-date", maxAge, now)).toBe(false);
  });
});
