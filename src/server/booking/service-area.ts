import { getEnv } from "@/config/env";

/**
 * Whether an address is somewhere the business will travel.
 *
 * Decided in code, never by the model. The service area used to reach the
 * assistant only as prose in the system prompt, which meant coverage was a
 * judgement a customer could argue with - and a model asked nicely enough will
 * make an exception the business never agreed to.
 *
 * The check is a configured list of place names matched against the address
 * text. Deliberately not a geocoding API: a single-tenant deployment covers a
 * handful of named municipalities, the list is exact, and a lookup that can
 * time out would put a third party between a customer and a booking.
 */

/** Null when no list is configured, meaning coverage cannot be decided here. */
export type CoverageResult = "inside" | "outside" | null;

function configuredPlaces(): string[] {
  return getEnv()
    .SERVICE_AREA_CITIES.split(",")
    .map((place) => place.trim().toLowerCase())
    .filter((place) => place.length > 0);
}

/**
 * Normalised for comparison: case, punctuation and repeated spaces removed.
 *
 * "Quezon City", "quezon  city," and "QUEZON CITY" are the same place, and a
 * customer typing an address into a phone will produce all three.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Where an address falls relative to the configured area.
 *
 * Returns null when nothing is configured. The caller must treat that as "not
 * decided" and let a person handle it, rather than assuming coverage - a
 * deployment that forgot to set the list should not silently accept every
 * address in the country.
 */
export function checkCoverage(serviceAddress: string): CoverageResult {
  const places = configuredPlaces();
  if (places.length === 0) return null;

  const haystack = normalize(serviceAddress);
  if (haystack.length === 0) return "outside";

  // Word-boundary matching, so "Makati" does not match inside another word and
  // a street called "Pasig Street" in another city is not read as the city.
  const words = new Set(haystack.split(" "));

  for (const place of places) {
    const parts = normalize(place).split(" ");

    if (parts.length === 1) {
      if (words.has(parts[0])) return "inside";
      continue;
    }

    // Multi-word places must appear as a contiguous phrase.
    if (haystack.includes(parts.join(" "))) return "inside";
  }

  return "outside";
}

/** True only when coverage is positively established. */
export function isWithinServiceArea(serviceAddress: string): boolean {
  return checkCoverage(serviceAddress) === "inside";
}
