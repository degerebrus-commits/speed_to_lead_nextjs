/**
 * Shown while the dashboard's queries run (STANDARDS.md 36). Mirrors the real
 * layout so the page does not jump when the numbers arrive.
 */
export default function DashboardLoading() {
  return (
    <>
      <h2>Dashboard</h2>
      <p className="subtitle">Loading metrics…</p>

      <div className="metric-grid" aria-busy="true" aria-label="Loading metrics">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="card" key={index}>
            <div className="skeleton" style={{ width: "45%" }} />
            <div className="skeleton skeleton-value" />
          </div>
        ))}
      </div>
    </>
  );
}
