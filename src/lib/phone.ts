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

    // Drop the national trunk prefix before adding a country code.
    //
    // Most of the world writes a domestic mobile with a leading 0 that exists
    // only for dialling inside the country - "0953 430 5571" in the
    // Philippines is "+63 953 430 5571" internationally, not "+63 0953...".
    // The US is the unusual one in having no trunk prefix, which is why this
    // never surfaced while the only configured country was +1: a Filipino
    // customer entering their number the normal way produced a 13-digit
    // number that does not exist, and nothing reported it as wrong.
    //
    // Italy is the notable exception - it keeps the leading zero. If this ever
    // serves an Italian deployment, that needs a per-country rule rather than
    // this one.
    const national = digits.replace(/^0+/, "");

    if (national.length === 0) {
      throw new PhoneNormalizationError(`Phone number is only zeroes: ${raw}`);
    }

    // A national number already carrying its country code (11 digits starting
    // with 1, for +1) versus a bare 10-digit local number.
    const alreadyPrefixed =
      national.startsWith(countryDigits) && national.length === countryDigits.length + 10;

    normalized = alreadyPrefixed ? `+${national}` : `+${countryDigits}${national}`;
  }

  if (!E164_PATTERN.test(normalized)) {
    throw new PhoneNormalizationError(`Phone number is not a valid E.164 number: ${normalized}`);
  }

  return normalized;
}
