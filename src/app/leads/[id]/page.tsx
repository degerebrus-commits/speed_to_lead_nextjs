import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDateTime, formatLeadStatus, formatTime, leadStatusTone } from "@/lib/format";
import { getLeadDetail } from "@/server/leads/lead-queries";

export const dynamic = "force-dynamic";

const APPOINTMENT_TONE = {
  CONFIRMED: "good",
  COMPLETED: "good",
  PENDING: "warn",
  CANCELLED: "bad",
} as const;

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lead = await getLeadDetail(id);

  // A mistyped or stale id is a 404, not an error screen - nothing went wrong.
  if (lead === null) notFound();

  return (
    <>
      <p className="subtitle">
        <Link href="/leads">← All leads</Link>
      </p>

      <h2>{lead.name}</h2>
      <p className="subtitle">
        <span className={`badge badge-${leadStatusTone(lead.status)}`}>
          {formatLeadStatus(lead.status)}
        </span>{" "}
        {lead.smsOptedOutAt !== null ? (
          <span className="badge badge-bad">Opted out</span>
        ) : null}
      </p>

      {lead.smsOptedOutAt !== null ? (
        <div className="notice notice-bad" role="status">
          <h3>This lead has opted out of texts.</h3>
          <p>
            They replied STOP on {formatDateTime(lead.smsOptedOutAt)}. Nothing
            further will be sent to this number, and nothing in this dashboard
            can override that.
          </p>
        </div>
      ) : lead.smsConsentAt === null ? (
        <div className="notice notice-bad" role="status">
          <h3>No SMS consent on record — nothing has been texted.</h3>
          <p>
            This lead arrived without a consent tick, so the introductory text
            was held rather than sent. Call them on {lead.phone} instead, and
            check that the website form carries the consent line — an automated
            text without recorded consent is not lawful, and the A2P
            registration is audited against it.
          </p>
        </div>
      ) : lead.introSmsSentAt === null ? (
        <div className="notice notice-warn" role="status">
          <h3>No introductory text has been sent.</h3>
          <p>
            The lead arrived {formatDateTime(lead.createdAt)} but the first
            message never went out. Running{" "}
            <code>POST /api/leads/retry-intro-sms</code> will pick it up.
          </p>
        </div>
      ) : null}

      <div className="card detail-grid">
        <div>
          <dt>Phone</dt>
          <dd>{lead.phone}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{lead.email ?? "Not provided"}</dd>
        </div>
        <div>
          <dt>Service address</dt>
          <dd>{lead.serviceAddress}</dd>
        </div>
        <div>
          <dt>Arrived</dt>
          <dd>{formatDateTime(lead.createdAt)}</dd>
        </div>
      </div>

      <h2>What they asked for</h2>
      <p className="subtitle">Submitted with the website form.</p>
      <div className="card" style={{ marginBottom: "28px", whiteSpace: "pre-wrap" }}>
        {lead.initialMessage}
      </div>

      <h2>Appointments</h2>
      {lead.appointments.length === 0 ? (
        <div className="empty-state" style={{ marginBottom: "28px" }}>
          <strong>No appointment yet.</strong>
          Once this lead picks a time slot over text, the booking will appear
          here.
        </div>
      ) : (
        <div className="table-scroll" style={{ marginBottom: "28px" }}>
          <table>
            <caption className="sr-only">Appointments for this lead</caption>
            <thead>
              <tr>
                <th scope="col">Slot</th>
                <th scope="col">Duration</th>
                <th scope="col">Status</th>
                <th scope="col">Booked</th>
              </tr>
            </thead>
            <tbody>
              {lead.appointments.map((appointment) => (
                <tr key={appointment.id}>
                  <td>{appointment.slotLabel}</td>
                  <td>{appointment.durationMinutes} min</td>
                  <td>
                    <span className={`badge badge-${APPOINTMENT_TONE[appointment.status]}`}>
                      {appointment.status.charAt(0) +
                        appointment.status.slice(1).toLowerCase()}
                    </span>
                  </td>
                  <td>{formatDateTime(appointment.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Conversation</h2>
      {lead.messages.length === 0 ? (
        <div className="empty-state">
          <strong>No messages yet.</strong>
          The introductory text and everything the customer replies will appear
          here as a thread.
        </div>
      ) : (
        <>
          <p className="subtitle">
            {lead.messages.length} message
            {lead.messages.length === 1 ? "" : "s"}, oldest first.
          </p>
          <ul className="thread">
            {lead.messages.map((message) => {
              const isInbound = message.direction === "INBOUND";
              const stamp = message.receivedAt ?? message.sentAt ?? message.createdAt;

              return (
                <li
                  key={message.id}
                  className={`bubble ${isInbound ? "bubble-inbound" : "bubble-outbound"}`}
                >
                  <p>{message.body}</p>
                  <span className="bubble-meta">
                    {isInbound ? `${lead.name} · ` : "Assistant · "}
                    {formatTime(stamp)}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
