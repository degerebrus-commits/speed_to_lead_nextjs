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
 * HVAC company, so process-local state is sufficient and adding a dependency
 * would buy nothing (STANDARDS.md 50). If the app is ever scaled to multiple
 * instances this must move to shared storage - a limit enforced per-process
 * would let N instances through N times.
 */
const windows = new Map<string, Window>();

export function checkRateLimit(key: string, maxRequests: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || now >= existing.resetAt) {
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
