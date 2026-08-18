/**
 * Placeholders a message template may contain. Unknown placeholders are left
 * untouched rather than blanked, so a typo in configuration is visible in the
 * output instead of silently producing a sentence with a hole in it.
 */
export interface MessageVariables {
  firstName: string;
  businessName: string;
  /** Name the assistant signs off with. Optional - the intro copy omits it. */
  repName?: string;
  /** Appointment time, used by the booking confirmation copy in Phase 5. */
  time?: string;
  /** Number a customer can call to reach a person, used by the HELP reply. */
  ownerPhone?: string;
}

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

/**
 * Substitutes {placeholder} tokens in a configured template.
 *
 * Deliberately not a template literal in code: the copy differs per client, so
 * it comes from configuration and is rendered here.
 */
export function renderTemplate(template: string, variables: MessageVariables): string {
  return template.replace(
    PLACEHOLDER_PATTERN,
    (match, key: string, offset: number, whole: string) => {
      const value = variables[key as keyof MessageVariables];
      if (value === undefined) return match;

      // A great many businesses are named "... Inc." or "... Ltd." - dropping
      // the value's own full stop where the template already supplies one at
      // the seam avoids texting a customer "Classic Air & Heat, Inc.. I'm...".
      const nextCharacter = whole[offset + match.length];
      if (value.endsWith(".") && nextCharacter === ".") {
        return value.slice(0, -1);
      }

      return value;
    },
  );
}

/**
 * First whitespace-delimited token of the submitted name. A form gives us one
 * free-text field, so this is a heuristic, not a parse - it just needs to make
 * the greeting read naturally.
 */
export function extractFirstName(fullName: string): string {
  const [first] = fullName.trim().split(/\s+/);
  return first && first.length > 0 ? first : fullName.trim();
}

/** Builds the introductory SMS for a lead from the configured template. */
export function buildIntroMessage(
  fullName: string,
  businessName: string,
  template: string,
  repName?: string,
): string {
  return renderTemplate(template, {
    firstName: extractFirstName(fullName),
    businessName,
    repName,
  });
}
