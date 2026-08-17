import { getEmergencyKeywords } from "@/config/business";

/**
 * Keyword matching for urgent situations.
 *
 * Deliberately implemented in application code rather than delegated to the
 * model (STANDARDS.md 21, 25). Two reasons, both of which have teeth:
 *
 *   1. An emergency must still be caught when the AI provider is down, rate
 *      limited, or slow. A safety path that depends on a third party being
 *      healthy is not a safety path.
 *   2. Model output is probabilistic. "Is this an emergency?" is a question
 *      whose wrong answer sends someone to bed in a house filling with gas.
 *
 * The AI still sees the message afterwards - this runs first and decides
 * whether it gets to answer at all.
 */

/** The literal opt-in word the after-hours message invites customers to send. */
const EXPLICIT_EMERGENCY_WORD = "emergency";

export interface EmergencyMatch {
  isEmergency: boolean;
  /** Which configured keyword fired. Null when nothing matched. */
  matchedKeyword: string | null;
}

/**
 * Normalises for comparison: lower case, punctuation stripped, whitespace
 * collapsed. "No heat!!" and "no  heat" must both match "no heat".
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectEmergency(messageBody: string): EmergencyMatch {
  const haystack = normalize(messageBody);

  if (haystack.length === 0) {
    return { isEmergency: false, matchedKeyword: null };
  }

  // The customer replying EMERGENCY to the after-hours message is an explicit
  // request, not a guess - honour it regardless of configured keywords.
  if (haystack.split(" ").includes(EXPLICIT_EMERGENCY_WORD)) {
    return { isEmergency: true, matchedKeyword: EXPLICIT_EMERGENCY_WORD };
  }

  for (const keyword of getEmergencyKeywords()) {
    const needle = normalize(keyword);
    if (needle.length === 0) continue;

    // Substring match on the normalised text: keywords are phrases such as
    // "gas smell" or "no hot water" that appear inside ordinary sentences.
    if (haystack.includes(needle)) {
      return { isEmergency: true, matchedKeyword: keyword };
    }
  }

  return { isEmergency: false, matchedKeyword: null };
}
