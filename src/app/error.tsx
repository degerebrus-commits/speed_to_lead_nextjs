"use client";

/**
 * Error boundary for the dashboard (STANDARDS.md 38): what happened, whether
 * anything was lost, and what to do next. The underlying message is not shown
 * - it can carry a connection string - but the digest is, so a report can be
 * matched to a server log.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <>
      <h2>Dashboard</h2>

      <div className="notice notice-bad" role="alert">
        <h3>The dashboard could not be loaded.</h3>
        <p>
          Nothing was changed, and no lead data was affected — this screen only
          reads. Try again; if it keeps failing, the server log has the actual
          cause.
        </p>
      </div>

      <button type="button" className="button" onClick={reset}>
        Try again
      </button>

      {error.digest ? (
        <p className="metric-note">Reference: {error.digest}</p>
      ) : null}
    </>
  );
}
