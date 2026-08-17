import { getEnv } from "@/config/env";

/**
 * Whether the business is open at a given instant, in its own timezone.
 *
 * Uses Intl rather than date arithmetic: the server may run anywhere, and
 * "is it 9am for the customer" is a question about the business's wall clock,
 * not the host's. Getting this wrong sends an after-hours apology at midday.
 */
export function isWithinBusinessHours(now: Date = new Date()): boolean {
  const env = getEnv();

  const openDays = new Set(
    env.BUSINESS_OPEN_DAYS.split(",")
      .map((day) => Number.parseInt(day.trim(), 10))
      .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7),
  );

  // No configured days means the schedule is unknown; treat as open so the
  // system talks to customers rather than silently falling back to
  // after-hours replies all day.
  if (openDays.size === 0) return true;

  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: env.BUSINESS_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const weekdayName = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hourText = parts.find((part) => part.type === "hour")?.value ?? "";

  const isoWeekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[weekdayName];
  const hour = Number.parseInt(hourText, 10);

  if (isoWeekday === undefined || Number.isNaN(hour)) return true;
  if (!openDays.has(isoWeekday)) return false;

  return hour >= env.BUSINESS_OPEN_HOUR && hour < env.BUSINESS_CLOSE_HOUR;
}
