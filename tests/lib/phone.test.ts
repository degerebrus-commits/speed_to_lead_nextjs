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

/**
 * Added when the first non-US deployment was configured.
 *
 * Most of the world writes a domestic mobile with a leading 0 that exists only
 * for dialling inside the country. The US has no trunk prefix, so while +1 was
 * the only configured country this was invisible - and a Filipino customer
 * entering their number the way they always write it produced a 13-digit
 * number that does not exist, with nothing reporting it as wrong.
 */
describe("national trunk prefixes", () => {
  it("collapses every way a Filipino writes their mobile to one number", () => {
    const expected = "+639534305571";

    for (const input of [
      "953 430 5571",
      "0953 430 5571",
      "09534305571",
      "+63 953 430 5571",
      "639534305571",
      "+639534305571",
    ]) {
      expect(normalizePhone(input, "+63"), input).toBe(expected);
    }
  });

  it("matters because the dedupe key is derived from the number", () => {
    // Before this, "0953..." and "953..." produced different numbers, so the
    // same customer submitting twice became two leads and got texted twice.
    expect(normalizePhone("09534305571", "+63")).toBe(normalizePhone("9534305571", "+63"));
  });

  it("does not change United States numbers, which have no trunk prefix", () => {
    const expected = "+15551234567";

    for (const input of ["(555) 123-4567", "5551234567", "15551234567", "+15551234567"]) {
      expect(normalizePhone(input, "+1"), input).toBe(expected);
    }
  });

  it("strips a trunk prefix for other countries that use one", () => {
    // The rule is general, not a Philippines special case.
    expect(normalizePhone("07700 900123", "+44")).toBe("+447700900123");
    expect(normalizePhone("0412 345 678", "+61")).toBe("+61412345678");
  });

  it("rejects a number that is only zeroes rather than inventing one", () => {
    expect(() => normalizePhone("0000", "+63")).toThrow();
  });
});
