import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies an HMAC-SHA256 webhook signature.
 *
 * The digest must be computed over the *raw* request body, never a re-encoded
 * object. Re-serialising changes key order and whitespace, which changes the
 * hash - and produces the maddening failure where every delivery is rejected
 * while the payload looks identical.
 */
export function isValidWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader || secret.length === 0) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.trim().toLowerCase();

  const providedBytes = Buffer.from(provided, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");

  // timingSafeEqual throws on a length mismatch. Length is not the secret.
  if (providedBytes.length !== expectedBytes.length) return false;

  return timingSafeEqual(providedBytes, expectedBytes);
}

/**
 * Rejects deliveries older than the window.
 *
 * TextBee documents no replay protection, so a captured request could
 * otherwise be resent indefinitely. Idempotency already stops a replay being
 * processed twice; this stops a very old one being processed at all.
 */
export function isWithinFreshnessWindow(
  timestamp: string | undefined,
  maxAgeMs: number,
  now: number = Date.now(),
): boolean {
  if (!timestamp) return false;

  const sentAt = new Date(timestamp).getTime();
  if (Number.isNaN(sentAt)) return false;

  // Allow a little clock skew in the future direction.
  const age = now - sentAt;
  return age <= maxAgeMs && age >= -60_000;
}
