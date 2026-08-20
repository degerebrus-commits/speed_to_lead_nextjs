import { prisma } from "@/lib/db";
import { isWithinBusinessHours } from "@/server/ai/business-hours";

/**
 * Dashboard metrics.
 *
 * Every figure here answers a question the business actually asks: is the
 * assistant replying fast enough, is it converting, and is anything stuck.
 * Vanity counts that nobody would act on are deliberately absent.
 */
export interface DashboardMetrics {
  /** The window these figures cover. */
  windowDays: number;
  windowStart: Date;

  leadsReceived: number;
  /** Leads whose introductory SMS is confirmed sent. */
  leadsContacted: number;
  /**
   * Leads still owed a first message. This is the one number that represents
   * a customer waiting, so it is the number worth acting on.
   */
  leadsAwaitingFirstContact: number;

  /**
   * Median seconds from lead arrival to intro SMS. Median rather than mean:
   * one lead stranded for a day would drag an average past the point of
   * usefulness, while the median still describes the typical customer.
   * Null when nothing has been contacted yet.
   */
  medianResponseSeconds: number | null;
  /** The slowest response in the window, in seconds. Null when none. */
  slowestResponseSeconds: number | null;

  appointmentsBooked: number;
  /**
   * Appointments created outside business hours. "Capture leads outside
   * business hours" is a stated product goal, so it needs its own figure -
   * folding these into the total would hide whether the goal is being met.
   */
  afterHoursBookings: number;
  /** Booked appointments as a percentage of leads received, 0-100. */
  bookingRatePercent: number;

  messagesSent: number;
  messagesReceived: number;
  /** Leads who texted STOP in the window. */
  optOuts: number;

  /**
   * Visits still ahead, and when the soonest one is.
   *
   * Deliberately not bounded by the reporting window. Every other figure here
   * looks back over the last N days; this one looks forward, and an owner
   * asking "what have I got coming up" does not mean "within the same N days I
   * happen to be reporting on".
   */
  upcomingVisits: number;
  nextVisitAt: Date | null;
}

/** A lead needing attention, for the dashboard's action list. */
export interface StalledLead {
  id: string;
  name: string;
  phone: string;
  createdAt: Date;
  waitingSeconds: number;
}

function startOfWindow(windowDays: number, now: Date): Date {
  return new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
}

/**
 * Median of a sorted-in-place copy. Returns null for an empty input rather
 * than 0, because "no data" and "zero seconds" are different claims and the
 * dashboard renders them differently.
 */
function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

export async function getDashboardMetrics(
  windowDays = 30,
  now: Date = new Date(),
): Promise<DashboardMetrics> {
  const windowStart = startOfWindow(windowDays, now);
  const inWindow = { gte: windowStart, lte: now };

  const [leads, appointments, messagesSent, messagesReceived, optOuts, upcoming] =
    await Promise.all([
      prisma.lead.findMany({
        where: { createdAt: inWindow },
        select: { createdAt: true, introSmsSentAt: true },
      }),
      prisma.appointment.findMany({
        where: { createdAt: inWindow },
        select: { createdAt: true },
      }),
      prisma.message.count({ where: { direction: "OUTBOUND", createdAt: inWindow } }),
      prisma.message.count({ where: { direction: "INBOUND", createdAt: inWindow } }),
      prisma.lead.count({ where: { smsOptedOutAt: inWindow } }),
      // Forward-looking, so no window: `gte: now` rather than `inWindow`.
      // Cancelled visits are excluded by status; a slot label that never
      // resolved to an instant has a null scheduledAt and cannot be counted as
      // upcoming, which the gte comparison excludes on its own.
      prisma.appointment.findMany({
        where: {
          status: { in: ["PENDING", "CONFIRMED"] },
          scheduledAt: { gte: now },
        },
        select: { scheduledAt: true },
        orderBy: { scheduledAt: "asc" },
      }),
    ]);

  const contacted = leads.filter((lead) => lead.introSmsSentAt !== null);

  const responseSeconds = contacted.map((lead) =>
    Math.max(
      0,
      Math.round(
        (lead.introSmsSentAt!.getTime() - lead.createdAt.getTime()) / 1000,
      ),
    ),
  );

  // Counted against the business's own clock, so a booking at 2am local time
  // registers as after-hours regardless of where the server runs.
  const afterHoursBookings = appointments.filter(
    (appointment) => !isWithinBusinessHours(appointment.createdAt),
  ).length;

  return {
    windowDays,
    windowStart,

    leadsReceived: leads.length,
    leadsContacted: contacted.length,
    leadsAwaitingFirstContact: leads.length - contacted.length,

    medianResponseSeconds: median(responseSeconds),
    slowestResponseSeconds:
      responseSeconds.length > 0 ? Math.max(...responseSeconds) : null,

    appointmentsBooked: appointments.length,
    afterHoursBookings,
    bookingRatePercent:
      leads.length === 0
        ? 0
        : Math.round((appointments.length / leads.length) * 1000) / 10,

    messagesSent,
    messagesReceived,
    optOuts,

    upcomingVisits: upcoming.length,
    nextVisitAt: upcoming[0]?.scheduledAt ?? null,
  };
}

/**
 * Leads that arrived but never received an introductory SMS, oldest first.
 *
 * Deliberately not limited to the metrics window: a lead stranded five weeks
 * ago is more urgent than one stranded this morning, and a window would hide
 * exactly the cases that most need chasing.
 */
export async function getStalledLeads(
  limit = 5,
  now: Date = new Date(),
): Promise<StalledLead[]> {
  const stranded = await prisma.lead.findMany({
    where: {
      introSmsSentAt: null,
      smsOptedOutAt: null,
      // A lead held for quiet hours is waiting, not stuck. Listing it here
      // would raise "still waiting for a first message" every night for
      // something working exactly as intended, and an alarm that cries wolf
      // stops being read.
      OR: [{ introSmsDeferredUntil: null }, { introSmsDeferredUntil: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, name: true, phone: true, createdAt: true },
  });

  return stranded.map((lead) => ({
    ...lead,
    waitingSeconds: Math.max(
      0,
      Math.round((now.getTime() - lead.createdAt.getTime()) / 1000),
    ),
  }));
}
