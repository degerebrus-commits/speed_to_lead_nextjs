import { getBusinessProfile } from "@/config/business";

/**
 * Turns a configured slot label into a real date and time.
 *
 * Labels like "Mon-Fri 9am" describe a *recurring window*, not an appointment.
 * Until this existed, the booking key was derived from the label alone and was
 * unique, so "Mon-Fri 9am" could exist once in the entire database - six
 * configured slots meant six bookings ever, after which nothing could be
 * booked again. Resolving to a concrete date makes the key date-specific, so
 * the same window is bookable next week.
 *
 * Deliberately hand-rolled rather than pulling in a date library: the grammar
 * is small, and it is parsed once at booking time (STANDARDS.md 50).
 */

const DAY_NAMES: Record<string, number> = {
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7,
};

export interface ParsedSlot {
  /** ISO weekdays this slot can fall on, 1=Monday .. 7=Sunday. */
  weekdays: number[];
  /** Hour in the business's own timezone, 0-23. */
  hour: number;
  minute: number;
}

/**
 * Parses "Mon-Fri 9am", "Sat 10am", "Tue 2:30pm". Returns null for anything it
 * does not understand, so an unparseable label degrades to "no timestamp"
 * rather than to a wrong one.
 */
export function parseSlotLabel(label: string): ParsedSlot | null {
  const text = label.trim().toLowerCase();

  const time = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (!time) return null;

  let hour = Number.parseInt(time[1], 10);
  const minute = time[2] ? Number.parseInt(time[2], 10) : 0;
  const meridiem = time[3];

  if (hour < 1 || hour > 12 || minute > 59) return null;
  if (meridiem === "pm" && hour !== 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  const days = text.slice(0, time.index).trim();

  // A range: "mon-fri".
  const range = days.match(/^([a-z]{3})\s*-\s*([a-z]{3})$/);
  if (range) {
    const from = DAY_NAMES[range[1]];
    const to = DAY_NAMES[range[2]];
    if (from === undefined || to === undefined) return null;

    const weekdays: number[] = [];
    for (let d = from; ; d = (d % 7) + 1) {
      weekdays.push(d);
      if (d === to) break;
      // Guard a range that never terminates rather than looping forever.
      if (weekdays.length > 7) return null;
    }
    return { weekdays, hour, minute };
  }

  // A list or a single day: "mon", "mon/wed", "mon, wed".
  const listed = days
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map((name) => DAY_NAMES[name.slice(0, 3)]);

  if (listed.length === 0 || listed.some((d) => d === undefined)) return null;

  return { weekdays: listed as number[], hour, minute };
}

/** The parts of an instant as they read on a given timezone's wall clock. */
function wallClock(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(instant);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";

  return {
    year: Number.parseInt(get("year"), 10),
    month: Number.parseInt(get("month"), 10),
    day: Number.parseInt(get("day"), 10),
    // en-US with hour12:false renders midnight as 24; normalise it.
    hour: Number.parseInt(get("hour"), 10) % 24,
    minute: Number.parseInt(get("minute"), 10),
    second: Number.parseInt(get("second"), 10),
    isoWeekday: DAY_NAMES[weekday.slice(0, 3).toLowerCase()] ?? 0,
  };
}

/**
 * The instant at which a given wall-clock time occurs in a timezone.
 *
 * Converged rather than calculated: guess the UTC instant, see what wall clock
 * it lands on, and correct by the difference. Two passes settle it either side
 * of a daylight-saving change, where the first correction can cross the
 * boundary it was compensating for.
 */
function instantForWallClock(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  let timestamp = Date.UTC(year, month - 1, day, hour, minute, 0);

  for (let pass = 0; pass < 2; pass += 1) {
    const seen = wallClock(new Date(timestamp), timeZone);
    const seenAsUtc = Date.UTC(
      seen.year,
      seen.month - 1,
      seen.day,
      seen.hour,
      seen.minute,
      seen.second,
    );
    const drift = seenAsUtc - Date.UTC(year, month - 1, day, hour, minute, 0);
    if (drift === 0) break;
    timestamp -= drift;
  }

  return new Date(timestamp);
}

/**
 * The next occurrence of a slot, strictly in the future.
 *
 * Returns null when the label cannot be parsed. Searches 14 days so a weekly
 * slot is always found even if today has already passed it.
 */
export function resolveNextOccurrence(
  label: string,
  now: Date = new Date(),
  timeZone: string = getBusinessProfile().timezone,
): Date | null {
  const parsed = parseSlotLabel(label);
  if (parsed === null) return null;

  const wanted = new Set(parsed.weekdays);

  for (let offset = 0; offset <= 14; offset += 1) {
    const probe = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    const local = wallClock(probe, timeZone);

    if (!wanted.has(local.isoWeekday)) continue;

    const candidate = instantForWallClock(
      local.year,
      local.month,
      local.day,
      parsed.hour,
      parsed.minute,
      timeZone,
    );

    // Strictly future: a slot at 9am is not offerable at 9am.
    if (candidate.getTime() > now.getTime()) return candidate;
  }

  return null;
}

/**
 * How far ahead to look for open slots.
 *
 * Three weeks. Long enough that a customer who turns down everything in the
 * next few days still gets offered something real, short enough that nobody is
 * asked to commit to a date they cannot plan around.
 */
export const SLOT_HORIZON_DAYS = 21;

/**
 * Every occurrence of a slot within the horizon, earliest first.
 *
 * resolveNextOccurrence answers "when is the next one", which is all a single
 * offer needs. Offering a *second* set after the customer turns down the first
 * needs the ones after that, so this returns the whole run.
 */
export function resolveOccurrences(
  label: string,
  now: Date = new Date(),
  horizonDays: number = SLOT_HORIZON_DAYS,
  timeZone: string = getBusinessProfile().timezone,
): Date[] {
  const parsed = parseSlotLabel(label);
  if (parsed === null) return [];

  const wanted = new Set(parsed.weekdays);
  const found: Date[] = [];

  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const probe = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    const local = wallClock(probe, timeZone);

    if (!wanted.has(local.isoWeekday)) continue;

    const candidate = instantForWallClock(
      local.year,
      local.month,
      local.day,
      parsed.hour,
      parsed.minute,
      timeZone,
    );

    if (candidate.getTime() > now.getTime()) found.push(candidate);
  }

  return found;
}

/**
 * How a slot is written to the customer: "Mon Aug 25, 9am".
 *
 * Carries the date, not just the weekday. The configured labels describe
 * recurring windows, so "Mon 9am" is ambiguous the moment a second week of
 * availability is on offer - and it is exactly then that someone turns down
 * the first set and gets shown the next.
 */
export function formatSlotForCustomer(
  at: Date,
  timeZone: string = getBusinessProfile().timezone,
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(at);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const minute = get("minute");
  const time =
    minute === "00"
      ? `${get("hour")}${get("dayPeriod").toLowerCase()}`
      : `${get("hour")}:${minute}${get("dayPeriod").toLowerCase()}`;

  return `${get("weekday")} ${get("month")} ${get("day")}, ${time}`;
}

/**
 * The booking key: the resolved date plus the label.
 *
 * The date is what makes this repeatable. Keyed on the label alone, a slot was
 * consumed permanently by the first customer to take it.
 *
 * Falls back to the label alone when the label cannot be parsed, preserving the
 * old behaviour for a configuration this code does not understand - unbookable
 * twice is better than double-booked.
 */
export function buildScheduledSlotKey(label: string, scheduledAt: Date | null): string {
  const normalised = label.trim().toLowerCase().replace(/\s+/g, " ");
  if (scheduledAt === null) return normalised;

  return `${scheduledAt.toISOString().slice(0, 10)}|${normalised}`;
}
