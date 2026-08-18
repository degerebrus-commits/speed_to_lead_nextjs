import { createHash } from "node:crypto";

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets. Sent as Retry-After on a 429. */
  retryAfterSeconds: number;
}

/**
 * Fixed-window limiter held in process memory.
 *
 * Deliberately not Redis: this system runs as a single deployment for a single
 * service business, so process-local state is sufficient and adding a dependency
 * would buy nothing (STANDARDS.md 50). If the app is ever scaled to multiple
 * instances this must move to shared storage - a limit enforced per-process
 * would let N instances through N times.
 */
const windows = new Map<string, Window>();

/**
 * Ceiling on distinct keys held at once.
 *
 * The key derives from a request header, so its cardinality is chosen by the
 * caller, not by us. Without a cap an unauthenticated attacker sending a fresh
 * X-Forwarded-For per request grows this map for a whole window - hundreds of
 * megabytes a minute, before any authentication has run.
 */
const MAX_TRACKED_KEYS = 10_000;

/**
 * Bounds a caller-supplied key.
 *
 * Hashing does two things: it fixes the length regardless of what arrived in
 * the header (Node accepts headers up to 16KB), and it keeps raw addresses out
 * of memory. Truncation is fine here - this is a bucket label, not a
 * credential, and a collision costs a shared rate limit.
 */
export function rateLimitKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

export function checkRateLimit(key: string, maxRequests: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || now >= existing.resetAt) {
    // At the ceiling, drop what has expired before admitting anything new.
    if (!existing && windows.size >= MAX_TRACKED_KEYS) {
      pruneRateLimitWindows(now);

      // Still full means the map is saturated with live windows, which is an
      // attack rather than traffic. Refuse rather than grow: a shared limit
      // degrades service, an unbounded map ends it.
      if (windows.size >= MAX_TRACKED_KEYS) {
        return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
      }
    }

    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;

  if (existing.count > maxRequests) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Drops expired windows. Called opportunistically from the route so the map
 * cannot grow without bound across a long-running process.
 */
export function pruneRateLimitWindows(now: number = Date.now()): void {
  for (const [key, window] of windows.entries()) {
    if (now >= window.resetAt) windows.delete(key);
  }
}

/** Test-only. */
export function resetRateLimits(): void {
  windows.clear();
}
