import Link from "next/link";

import { formatDateParts, formatDateTime, formatDuration, formatTime } from "@/lib/format";
import { getDashboardMetrics, getStalledLeads } from "@/server/analytics/metrics-service";
import { getSchedule } from "@/server/booking/schedule-queries";
import { requireSession } from "@/server/auth/require-session";

// Metrics reflect leads arriving continuously; a cached page would show an
// owner stale numbers and, worse, a stale "waiting for first contact" count.
export const dynamic = "force-dynamic";

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="card">
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      {note ? <p className="metric-note">{note}</p> : null}
    </div>
  );
}

export default async function DashboardPage() {
  await requireSession();

  const [metrics, stalled, schedule] = await Promise.all([
    getDashboardMetrics(),
    getStalledLeads(),
    getSchedule(),
  ]);

  const scheduleTotal = schedule.reduce((sum, day) => sum + day.visits.length, 0);

  const hasAnyLeads = metrics.leadsReceived > 0 || stalled.length > 0;

  return (
    <>
      <h2>Dashboard</h2>
      <p className="subtitle">
        Last {metrics.windowDays} days, since {formatDateTime(metrics.windowStart)}.
      </p>

      {!hasAnyLeads ? (
        <div className="empty-state">
          <strong>No leads yet.</strong>
          When a customer submits the website form, they will appear here and
          receive an introductory text automatically.
        </div>
      ) : (
        <>
          {stalled.length > 0 ? (
            <div className="notice notice-warn" role="status">
              <h3>
                {stalled.length === 1
                  ? "1 lead is still waiting for a first message"
                  : `${stalled.length} leads are still waiting for a first message`}
              </h3>
              <p>
                Longest wait: {formatDuration(stalled[0].waitingSeconds)} (
                {stalled[0].name}). Retry them with{" "}
                <code>POST /api/leads/retry-intro-sms</code>.
              </p>
            </div>
          ) : null}

          <div className="metric-grid">
            <Metric
              label="Leads received"
              value={String(metrics.leadsReceived)}
              note={`${metrics.leadsContacted} contacted`}
            />
            <Metric
              label="Median response time"
              value={
                metrics.medianResponseSeconds === null
                  ? "—"
                  : formatDuration(metrics.medianResponseSeconds)
              }
              note={
                metrics.slowestResponseSeconds === null
                  ? "No leads contacted yet"
                  : `Slowest ${formatDuration(metrics.slowestResponseSeconds)}`
              }
            />
            <Metric
              label="Appointments booked"
              value={String(metrics.appointmentsBooked)}
              note="In this window"
            />
            <Metric
              label="Booking rate"
              value={`${metrics.bookingRatePercent}%`}
              note="Of leads received in this window"
            />
            <Metric
              label="Messages"
              value={`${metrics.messagesSent} / ${metrics.messagesReceived}`}
              note="Sent / received"
            />
            <Metric
              label="Awaiting first contact"
              value={String(metrics.leadsAwaitingFirstContact)}
              note={
                metrics.optOuts > 0
                  ? `${metrics.optOuts} opted out this window`
                  : "No opt-outs this window"
              }
            />
            {/*
              The bookings the business would not otherwise have. Every other
              figure here also describes a business with someone answering the
              phone; this one only exists because nobody was.
            */}
            <Metric
              label="Booked after hours"
              value={String(metrics.afterHoursBookings)}
              note={
                metrics.appointmentsBooked > 0
                  ? `Of ${metrics.appointmentsBooked} booked, while closed`
                  : "While the business was closed"
              }
            />
            <Metric
              label="Upcoming visits"
              value={String(metrics.upcomingVisits)}
              note={
                metrics.nextVisitAt === null
                  ? "Nothing scheduled"
                  : `Next ${formatDateTime(metrics.nextVisitAt)}`
              }
            />
          </div>

          <h2>Schedule</h2>
          <p className="subtitle">
            {scheduleTotal === 0
              ? "Nothing booked in the next seven days."
              : `${scheduleTotal} visit${scheduleTotal === 1 ? "" : "s"} over the next seven days.`}
          </p>

          <div className="schedule-grid">
            {schedule.map((day) => (
              <div key={day.key} className="schedule-day">
                <p className={day.isToday ? "schedule-date is-today" : "schedule-date"}>
                  {day.weekday} {day.dayOfMonth}
                </p>

                {day.visits.length === 0 ? (
                  <p className="schedule-none">—</p>
                ) : (
                  day.visits.map((visit) => (
                    <Link
                      key={visit.appointmentId}
                      href={`/leads/${visit.leadId}`}
                      className={visit.optedOut ? "visit visit-flagged" : "visit"}
                      // The card carries a time and a first name; a screen
                      // reader gets the whole appointment.
                      aria-label={`${formatTime(visit.scheduledAt)}, ${visit.name}, ${visit.serviceAddress}${
                        visit.optedOut ? ", opted out of texts" : ""
                      }`}
                    >
                      <span className="visit-time">{formatTime(visit.scheduledAt)}</span>
                      <span className="visit-name">{visit.name}</span>
                      {visit.optedOut ? (
                        <span className="visit-flag">Opted out</span>
                      ) : null}
                    </Link>
                  ))
                )}
              </div>
            ))}
          </div>

          {stalled.length > 0 ? (
            <>
              <h2>Needs attention</h2>
              <p className="subtitle">
                Leads that arrived but never received an introductory text,
                oldest first.
              </p>
              <div className="table-scroll">
                <table>
                  <caption className="sr-only">Leads awaiting a first message</caption>
                  <thead>
                    <tr>
                      <th scope="col">Lead</th>
                      <th scope="col">Phone</th>
                      <th scope="col">Arrived</th>
                      <th scope="col">Waiting</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stalled.map((lead) => (
                      <tr key={lead.id}>
                        <td>
                          <Link href={`/leads/${lead.id}`}>{lead.name}</Link>
                        </td>
                        <td>{lead.phone}</td>
                        <td className="stamp">
                      {formatDateParts(lead.createdAt).date}
                      <span className="stamp-time">{formatDateParts(lead.createdAt).time}</span>
                    </td>
                        <td>{formatDuration(lead.waitingSeconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      )}
    </>
  );
}
