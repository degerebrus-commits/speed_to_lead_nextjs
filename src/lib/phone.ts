/** Thrown when input cannot be resolved to a plausible E.164 number. */
export class PhoneNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhoneNormalizationError";
  }
}

/** E.164: leading +, a non-zero country digit, 8-15 digits total. */
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/**
 * Normalises whatever the website form submitted into E.164.
 *
 * This matters beyond tidiness: the deduplication key is derived from the
 * phone number, so "(555) 123-4567" and "+15551234567" must collapse to the
 * same string or a retried submission would create a second lead and text the
 * customer twice.
 */
export function normalizePhone(raw: string, countryCode: string): string {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    throw new PhoneNormalizationError("Phone number is empty");
  }

  const hasExplicitCountryCode = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length === 0) {
    throw new PhoneNormalizationError("Phone number contains no digits");
  }

  let normalized: string;

  if (hasExplicitCountryCode) {
    normalized = `+${digits}`;
  } else {
    const countryDigits = countryCode.replace(/\D/g, "");
    // A national number already carrying its country code (11 digits starting
    // with 1, for +1) versus a bare 10-digit local number.
    const alreadyPrefixed =
      digits.startsWith(countryDigits) && digits.length === countryDigits.length + 10;
    normalized = alreadyPrefixed ? `+${digits}` : `+${countryDigits}${digits}`;
  }

  if (!E164_PATTERN.test(normalized)) {
    throw new PhoneNormalizationError(`Phone number is not a valid E.164 number: ${normalized}`);
  }

  return normalized;
}
