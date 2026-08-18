/** Loading state for the lead list (STANDARDS.md 36). */
export default function LeadsLoading() {
  return (
    <>
      <h2>Leads</h2>
      <p className="subtitle">Loading leads…</p>

      <div className="card" aria-busy="true" aria-label="Loading leads">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            className="skeleton"
            key={index}
            style={{ marginBottom: "14px", width: `${90 - index * 6}%` }}
          />
        ))}
      </div>
    </>
  );
}
