import { getEnv } from "@/config/env";

/**
 * When an unsolicited first text may not be sent.
 *
 * This governs the intro SMS only. A reply to a customer who just texted goes
 * out at any hour: they are awake, they are waiting, and answering is both
 * courteous and a far safer legal position than initiating contact. What the
 * TCPA restricts, and what carriers police, is the message a business starts.
 *
 * The window is expressed in the business's own timezone. A server in another
 * region must not decide that 3am local is a reasonable time to text someone.
 */

/** Hours on the business's wall clock, e.g. 21 and 8 for 9pm until 8am. */
function windowHours(): { start: number; end: number } | null {
  const env = getEnv();
  if (env.QUIET_HOURS_ENABLED !== "true") return null;

  return { start: env.QUIET_HOURS_START, end: env.QUIET_HOURS_END };
}

function localHour(instant: Date, timeZone: string): number {
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).format(instant);

  // en-GB with hour12:false renders midnight as 24; normalise it.
  return Number.parseInt(text, 10) % 24;
}

/** Whether an unsolicited text would land inside the quiet window. */
export function isQuietHour(now: Date = new Date()): boolean {
  const window = windowHours();
  if (window === null) return false;

  const hour = localHour(now, getEnv().BUSINESS_TIMEZONE);

  // The window normally wraps midnight (21 to 8), so "inside" is either side of
  // the wrap. A non-wrapping window (1 to 6) is the ordinary between case.
  return window.start > window.end
    ? hour >= window.start || hour < window.end
    : hour >= window.start && hour < window.end;
}

/**
 * The next instant an unsolicited text may go out, or null if now is fine.
 *
 * Steps forward an hour at a time rather than computing a boundary. The
 * arithmetic version has to reason about DST, month ends and a window that
 * wraps midnight; this one asks the same question the send path asks, which is
 * the question that actually matters, and 24 iterations is nothing.
 */
export function nextSendableAt(now: Date = new Date()): Date | null {
  if (!isQuietHour(now)) return null;

  const probe = new Date(now.getTime());

  // Land on the start of an hour first, so the held lead is released at the
  // top of the window rather than at whatever minute it happened to arrive.
  probe.setUTCMinutes(0, 0, 0);

  for (let step = 0; step <= 24; step += 1) {
    probe.setTime(probe.getTime() + 60 * 60 * 1000);
    if (!isQuietHour(probe)) return probe;
  }

  // Unreachable unless the window covers the whole day, which the schema
  // forbids by requiring start and end to differ. Returning null rather than
  // looping forever means the text goes out now, which is the safer failure:
  // a lead contacted at an odd hour beats a lead never contacted at all.
  return null;
}
