import type { LeadStatus } from "@prisma/client";
import Link from "next/link";

import {
  LEAD_STATUS_ORDER,
  formatDateTime,
  formatLeadStatus,
  leadStatusTone,
} from "@/lib/format";
import { requireSession } from "@/server/auth/require-session";
import { countLeadsByStatus, listLeads } from "@/server/leads/lead-queries";

export const dynamic = "force-dynamic";

function isLeadStatus(value: string | undefined): value is LeadStatus {
  return value !== undefined && (LEAD_STATUS_ORDER as string[]).includes(value);
}

/** Truncated for the row preview; the full text is on the lead's own page. */
function preview(body: string | null): string {
  if (body === null) return "—";
  return body.length > 90 ? `${body.slice(0, 90)}…` : body;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  await requireSession("/leads");

  const params = await searchParams;

  // An unrecognised status in the URL shows everything rather than erroring:
  // a hand-edited query string is not worth a failure screen.
  const status = isLeadStatus(params.status) ? params.status : undefined;
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) ? requestedPage : 1;

  const [result, counts] = await Promise.all([
    listLeads({ status, page }),
    countLeadsByStatus(),
  ]);

  const filterHref = (value?: LeadStatus) =>
    value === undefined ? "/leads" : `/leads?status=${value}`;

  return (
    <>
      <h2>Leads</h2>
      <p className="subtitle">
        {result.total === 0
          ? "No leads match this filter."
          : `${result.total} lead${result.total === 1 ? "" : "s"}, newest first.`}
      </p>

      <div className="filters">
        <Link href={filterHref()} aria-current={status === undefined}>
          All
        </Link>
        {LEAD_STATUS_ORDER.filter((value) => (counts[value] ?? 0) > 0).map((value) => (
          <Link key={value} href={filterHref(value)} aria-current={status === value}>
            {formatLeadStatus(value)} ({counts[value]})
          </Link>
        ))}
      </div>

      {result.leads.length === 0 ? (
        <div className="empty-state">
          <strong>
            {status === undefined
              ? "No leads yet."
              : `No leads with status “${formatLeadStatus(status)}”.`}
          </strong>
          {status === undefined ? (
            <>
              When a customer submits the website form, they will appear here and
              receive an introductory text automatically.
            </>
          ) : (
            <>
              Try <Link href="/leads">all leads</Link> instead.
            </>
          )}
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table>
              <caption className="sr-only">Leads, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Status</th>
                  <th scope="col">Latest message</th>
                  <th scope="col">Arrived</th>
                </tr>
              </thead>
              <tbody>
                {result.leads.map((lead) => (
                  <tr key={lead.id}>
                    <td>
                      <Link href={`/leads/${lead.id}`}>{lead.name}</Link>
                      <br />
                      <span className="metric-note">{lead.phone}</span>
                    </td>
                    <td>
                      <span className={`badge badge-${leadStatusTone(lead.status)}`}>
                        {formatLeadStatus(lead.status)}
                      </span>
                      {lead.smsOptedOutAt !== null ? (
                        <>
                          {" "}
                          <span className="badge badge-bad">Opted out</span>
                        </>
                      ) : null}
                      {lead.smsConsentAt === null ? (
                        <>
                          {" "}
                          <span className="badge badge-bad">No SMS consent</span>
                        </>
                      ) : lead.introSmsSentAt === null && lead.smsOptedOutAt === null ? (
                        <>
                          {" "}
                          <span className="badge badge-warn">Awaiting first text</span>
                        </>
                      ) : null}
                      {lead.hasAppointment ? (
                        <>
                          {" "}
                          <span className="badge badge-good">Appointment</span>
                        </>
                      ) : null}
                    </td>
                    <td>{preview(lead.lastMessageBody)}</td>
                    <td>{formatDateTime(lead.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.totalPages > 1 ? (
            <nav className="pager" aria-label="Pagination">
              {result.page > 1 ? (
                <Link
                  href={`/leads?${new URLSearchParams({
                    ...(status ? { status } : {}),
                    page: String(result.page - 1),
                  })}`}
                >
                  ← Previous
                </Link>
              ) : null}
              <span>
                Page {result.page} of {result.totalPages}
              </span>
              {result.page < result.totalPages ? (
                <Link
                  href={`/leads?${new URLSearchParams({
                    ...(status ? { status } : {}),
                    page: String(result.page + 1),
                  })}`}
                >
                  Next →
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
