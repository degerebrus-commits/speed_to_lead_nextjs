import type { LeadStatus } from "@prisma/client";

import { getBusinessProfile } from "@/config/business";

/**
 * Human durations for the dashboard. Seconds matter for speed-to-lead - the
 * product's whole claim is a reply in under five minutes - so the scale starts
 * there rather than rounding everything to "less than a minute".
 */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    const seconds = totalSeconds % 60;
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remainder = minutes % 60;
    return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
  }

  const days = Math.floor(hours / 24);
  const remainder = hours % 24;
  return remainder === 0 ? `${days}d` : `${days}d ${remainder}h`;
}

/**
 * Timestamps are rendered in the business's timezone, not the viewer's or the
 * server's. An owner looking at "9:04pm" needs it to mean their evening.
 */
export function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: getBusinessProfile().timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export function formatTime(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: getBusinessProfile().timezone,
    timeStyle: "short",
  }).format(value);
}

/**
 * The same instant split into its two lines, for table cells.
 *
 * `formatDateTime` returns one string, which in a narrow column wraps wherever
 * the width happens to run out - after the year on one row, mid-time on the
 * next. The eye cannot scan a column whose break moves. Splitting it puts the
 * date on top and the time beneath on every row, at the cost of the caller
 * rendering two elements instead of one.
 *
 * Prose keeps `formatDateTime`: "They replied STOP on Aug 20, 2026, 10:05 AM"
 * is a sentence, not a column.
 */
export function formatDateParts(value: Date): { date: string; time: string } {
  const timeZone = getBusinessProfile().timezone;

  return {
    date: new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium" }).format(value),
    time: new Intl.DateTimeFormat("en-US", { timeZone, timeStyle: "short" }).format(value),
  };
}

/** Status labels in sentence case; the enum's SCREAMING_SNAKE is not for humans. */
const STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  ENGAGED: "Engaged",
  QUALIFIED: "Qualified",
  APPOINTMENT_PENDING: "Appointment pending",
  BOOKED: "Booked",
  HUMAN_HANDOFF: "Needs a human",
  NOT_QUALIFIED: "Not qualified",
  LOST: "Lost",
  CLOSED: "Closed",
};

export function formatLeadStatus(status: LeadStatus): string {
  return STATUS_LABELS[status];
}

/**
 * Badge tone per status. Paired with the text label everywhere it is used -
 * colour never carries the meaning by itself (STANDARDS.md 35).
 */
export function leadStatusTone(status: LeadStatus): "good" | "warn" | "bad" | "neutral" {
  switch (status) {
    case "BOOKED":
    case "QUALIFIED":
      return "good";
    case "HUMAN_HANDOFF":
    case "APPOINTMENT_PENDING":
      return "warn";
    case "LOST":
    case "NOT_QUALIFIED":
      return "bad";
    default:
      return "neutral";
  }
}

export const LEAD_STATUS_ORDER: LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "ENGAGED",
  "QUALIFIED",
  "APPOINTMENT_PENDING",
  "BOOKED",
  "HUMAN_HANDOFF",
  "NOT_QUALIFIED",
  "LOST",
  "CLOSED",
];
