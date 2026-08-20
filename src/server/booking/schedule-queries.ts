import { getBusinessProfile } from "@/config/business";
import { prisma } from "@/lib/db";

/**
 * The next few days of visits, grouped by day, for the dashboard.
 *
 * Reads only our own database. The appointments here were written to Google
 * Calendar when they were booked, but rendering from Postgres means the page
 * still works when Google is down - and an owner who cannot see today's
 * schedule because a third party is unavailable would rightly stop trusting it.
 */

export interface ScheduledVisit {
  appointmentId: string;
  leadId: string;
  name: string;
  phone: string;
  serviceAddress: string;
  scheduledAt: Date;
  /**
   * The customer texted STOP. The visit still stands, and the assistant can no
   * longer reach them to confirm or move it - so this is the one card on the
   * page that needs a person to pick up the phone.
   */
  optedOut: boolean;
}

export interface ScheduleDay {
  /** Stable YYYY-MM-DD in the business's timezone; also the React key. */
  key: string;
  /** "Thu" */
  weekday: string;
  /** "20" */
  dayOfMonth: string;
  isToday: boolean;
  visits: ScheduledVisit[];
}

/**
 * The day an instant falls on, as the business reads it.
 *
 * en-CA formats as YYYY-MM-DD, which sorts correctly as a string and needs no
 * parsing. Grouping on the UTC date instead would put a 9am Manila visit on the
 * previous day for eight months of the year and nobody would notice until an
 * owner said "that job isn't on Tuesday".
 */
function dayKey(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function dayLabels(instant: Date, timeZone: string): { weekday: string; dayOfMonth: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    day: "numeric",
  }).formatToParts(instant);

  return {
    weekday: parts.find((p) => p.type === "weekday")?.value ?? "",
    dayOfMonth: parts.find((p) => p.type === "day")?.value ?? "",
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `days` columns starting today, each present whether or not it holds anything.
 *
 * Empty days are returned rather than skipped: a grid that omits them would
 * put Friday next to Monday and read as though the week were full.
 *
 * Visits earlier today are included. An owner looking at the dashboard in the
 * afternoon still wants this morning's job on the page - the column is "today",
 * not "what is left of today".
 */
export async function getSchedule(
  days = 7,
  now: Date = new Date(),
): Promise<ScheduleDay[]> {
  const { timezone } = getBusinessProfile();

  // Deliberately generous at both ends, then filtered by day key below. The
  // alternative - computing the exact UTC instant of local midnight - is
  // arithmetic that goes wrong at DST boundaries, and this needs no such
  // reasoning to be correct.
  const appointments = await prisma.appointment.findMany({
    where: {
      status: { in: ["PENDING", "CONFIRMED"] },
      scheduledAt: {
        gte: new Date(now.getTime() - DAY_MS),
        lte: new Date(now.getTime() + (days + 1) * DAY_MS),
      },
    },
    select: {
      id: true,
      scheduledAt: true,
      lead: {
        select: {
          id: true,
          name: true,
          phone: true,
          serviceAddress: true,
          smsOptedOutAt: true,
        },
      },
    },
    orderBy: { scheduledAt: "asc" },
  });

  const byDay = new Map<string, ScheduledVisit[]>();

  for (const appointment of appointments) {
    // Narrowing only: the query cannot return a null scheduledAt through a gte
    // comparison, but the column is nullable and the type reflects that.
    if (appointment.scheduledAt === null) continue;

    const key = dayKey(appointment.scheduledAt, timezone);
    const visits = byDay.get(key) ?? [];

    visits.push({
      appointmentId: appointment.id,
      leadId: appointment.lead.id,
      name: appointment.lead.name,
      phone: appointment.lead.phone,
      serviceAddress: appointment.lead.serviceAddress,
      scheduledAt: appointment.scheduledAt,
      optedOut: appointment.lead.smsOptedOutAt !== null,
    });

    byDay.set(key, visits);
  }

  const todayKey = dayKey(now, timezone);

  return Array.from({ length: days }, (_, offset) => {
    // Stepping by 24h from `now` lands mid-day rather than at a boundary, so a
    // DST shift of an hour cannot roll the label onto the wrong date.
    const instant = new Date(now.getTime() + offset * DAY_MS);
    const key = dayKey(instant, timezone);

    return {
      key,
      ...dayLabels(instant, timezone),
      isToday: key === todayKey,
      visits: byDay.get(key) ?? [],
    };
  });
}
