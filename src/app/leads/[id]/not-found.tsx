import Link from "next/link";

/**
 * Reached when the id in the URL matches no lead. Distinct from the error
 * boundary on purpose: nothing failed, the row simply is not there
 * (STANDARDS.md 38).
 */
export default function LeadNotFound() {
  return (
    <>
      <h2>Lead not found</h2>
      <div className="empty-state">
        <strong>No lead matches this address.</strong>
        It may have been removed, or the link may be mistyped.{" "}
        <Link href="/leads">Back to all leads</Link>.
      </div>
    </>
  );
}
