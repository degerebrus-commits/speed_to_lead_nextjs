import type { Appointment, Lead } from "@prisma/client";

import { getBusinessProfile } from "@/config/business";
import { getEnv } from "@/config/env";
import { logger } from "@/lib/logger";
import { getGoogleAccessToken } from "./google-auth";

/**
 * Writes confirmed appointments into the business's Google Calendar.
 *
 * Secondary to the database, deliberately. The appointment is already booked
 * and the customer already told so by the time this runs; a calendar outage
 * must not turn a successful booking into a failed one. Every failure here is
 * logged and swallowed, and the missing calendarEventId is the queue for a
 * later backfill.
 */

const CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars";

export interface CalendarEventResult {
  eventId: string | null;
  /** Why nothing was written. Null on success. */
  skipped: "not-configured" | "no-scheduled-time" | "failed" | null;
}

/** Whether all three credentials are present. */
export function isCalendarConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY && env.GOOGLE_CALENDAR_ID);
}

export interface BusyInterval {
  start: Date;
  end: Date;
}

/**
 * When the business is already occupied, from the calendar itself.
 *
 * This is what makes an offered slot genuinely open rather than merely
 * unbooked-by-us. The owner's own entries - a supplier meeting, a day off -
 * are invisible to our database, and offering a time they are standing in
 * someone else's kitchen is how an assistant loses the business's trust.
 *
 * Uses events.list rather than freeBusy deliberately: freeBusy needs a broader
 * OAuth scope than the calendar.events one this service account requests, and
 * a narrower scope is worth an extra few lines of filtering.
 *
 * Returns an empty list on any failure. Falling back to "nothing is busy" errs
 * toward offering a slot that turns out to be taken, which the business can
 * decline - the alternative, erring toward silence, loses the lead outright.
 */
export async function getBusyIntervals(from: Date, to: Date): Promise<BusyInterval[]> {
  if (!isCalendarConfigured()) return [];

  const calendarId = getEnv().GOOGLE_CALENDAR_ID as string;

  try {
    const token = await getGoogleAccessToken();

    const url =
      `${CALENDAR_API}/${encodeURIComponent(calendarId)}/events` +
      `?timeMin=${encodeURIComponent(from.toISOString())}` +
      `&timeMax=${encodeURIComponent(to.toISOString())}` +
      // singleEvents expands a recurring weekly commitment into the individual
      // occurrences. Without it a repeating event is one entry with no usable
      // start time, and every occurrence after the first reads as free.
      `&singleEvents=true&orderBy=startTime&maxResults=250`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      logger.error("Could not read calendar availability", {
        status: response.status,
        detail: (await response.text().catch(() => "")).slice(0, 200),
      });
      return [];
    }

    const payload = (await response.json()) as {
      items?: Array<{
        status?: string;
        transparency?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
      }>;
    };

    const busy: BusyInterval[] = [];

    for (const item of payload.items ?? []) {
      // "transparent" is Google's flag for "free" - an event marked as not
      // blocking time. Cancelled entries are still returned and must not
      // consume availability.
      if (item.status === "cancelled") continue;
      if (item.transparency === "transparent") continue;

      const startRaw = item.start?.dateTime ?? item.start?.date;
      const endRaw = item.end?.dateTime ?? item.end?.date;
      if (!startRaw || !endRaw) continue;

      const start = new Date(startRaw);
      const end = new Date(endRaw);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

      busy.push({ start, end });
    }

    return busy;
  } catch (error) {
    logger.error("Calendar availability lookup failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/** Whether a proposed visit runs into anything already on the calendar. */
export function overlapsBusy(start: Date, end: Date, busy: BusyInterval[]): boolean {
  // Touching at the boundary is not an overlap: a visit ending at 11:00 and one
  // starting at 11:00 can both stand.
  return busy.some((b) => start < b.end && end > b.start);
}

/**
 * The event title and body the business sees.
 *
 * Written for someone glancing at a phone between jobs: who, what number, what
 * is wrong. The address goes in `location` so the calendar app offers
 * navigation rather than making them copy it out of a description.
 */
export function buildEventFields(lead: Lead, appointment: Appointment) {
  const business = getBusinessProfile();
  const firstName = lead.name.trim().split(/\s+/)[0] || lead.name;

  return {
    summary: `${business.vertical} visit - ${firstName} (${lead.phone})`,
    location: lead.serviceAddress,
    description: [
      `Customer: ${lead.name}`,
      `Phone: ${lead.phone}`,
      lead.email ? `Email: ${lead.email}` : null,
      `Address: ${lead.serviceAddress}`,
      "",
      `What they said: ${lead.initialMessage}`,
      "",
      `Slot: ${appointment.slotLabel}`,
      `Booked automatically by ${business.name}'s assistant.`,
    ]
      .filter((line) => line !== null)
      .join("\n"),
  };
}

/**
 * Creates the calendar event for a booked appointment.
 *
 * Never throws. The caller has already committed the booking.
 */
export async function createCalendarEvent(
  lead: Lead,
  appointment: Appointment,
): Promise<CalendarEventResult> {
  if (!isCalendarConfigured()) {
    return { eventId: null, skipped: "not-configured" };
  }

  if (!appointment.scheduledAt || !appointment.scheduledEndAt) {
    // A slot label that could not be resolved to a real date. It exists in the
    // database as a booking, but there is no instant to put on a calendar.
    logger.warn("Appointment has no resolved time; nothing written to the calendar", {
      appointmentId: appointment.id,
      slotLabel: appointment.slotLabel,
    });
    return { eventId: null, skipped: "no-scheduled-time" };
  }

  const env = getEnv();
  const calendarId = env.GOOGLE_CALENDAR_ID as string;
  const { timezone } = getBusinessProfile();
  const fields = buildEventFields(lead, appointment);

  try {
    const token = await getGoogleAccessToken();

    const response = await fetch(
      `${CALENDAR_API}/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...fields,
          // Absolute instants, with the timezone alongside for display. The
          // stored times are already UTC, so the offset carries the meaning
          // and the timeZone field only decides how it is shown.
          start: { dateTime: appointment.scheduledAt.toISOString(), timeZone: timezone },
          end: { dateTime: appointment.scheduledEndAt.toISOString(), timeZone: timezone },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "<unreadable>");
      logger.error("Google Calendar rejected the event", {
        appointmentId: appointment.id,
        status: response.status,
        // 403 here almost always means the calendar is shared with the service
        // account as read-only rather than "Make changes to events".
        detail: detail.slice(0, 300),
      });
      return { eventId: null, skipped: "failed" };
    }

    const created = (await response.json()) as { id?: string };

    logger.info("Calendar event created", {
      appointmentId: appointment.id,
      eventId: created.id,
    });

    return { eventId: created.id ?? null, skipped: created.id ? null : "failed" };
  } catch (error) {
    logger.error("Could not write the appointment to the calendar", {
      appointmentId: appointment.id,
      reason: error instanceof Error ? error.message : String(error),
    });
    return { eventId: null, skipped: "failed" };
  }
}
