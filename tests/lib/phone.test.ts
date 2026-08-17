import { describe, expect, it } from "vitest";
import { PhoneNormalizationError, normalizePhone } from "@/lib/phone";

describe("normalizePhone", () => {
  it("collapses the formats a website form actually submits to one E.164 string", () => {
    // The dedupe key is derived from this output, so every spelling of the
    // same number must produce the identical result.
    const variants = [
      "(555) 123-4567",
      "555-123-4567",
      "555.123.4567",
      "5551234567",
      " 555 123 4567 ",
      "15551234567",
      "+15551234567",
    ];

    for (const variant of variants) {
      expect(normalizePhone(variant, "+1"), `input: ${variant}`).toBe("+15551234567");
    }
  });

  it("keeps an explicitly supplied country code instead of prefixing again", () => {
    expect(normalizePhone("+44 20 7946 0958", "+1")).toBe("+442079460958");
  });

  it("applies the configured country code, not a hardcoded +1", () => {
    expect(normalizePhone("2079460958", "+44")).toBe("+442079460958");
  });

  it("rejects input that cannot be a phone number", () => {
    expect(() => normalizePhone("", "+1")).toThrow(PhoneNormalizationError);
    expect(() => normalizePhone("   ", "+1")).toThrow(PhoneNormalizationError);
    expect(() => normalizePhone("not-a-phone", "+1")).toThrow(PhoneNormalizationError);
    expect(() => normalizePhone("123", "+1")).toThrow(PhoneNormalizationError);
  });
});
