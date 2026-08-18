import { createHmac, timingSafeEqual } from "node:crypto";

import { getEnv } from "@/config/env";

export { SESSION_COOKIE } from "./session-cookie";

/**
 * Dashboard sessions.
 *
 * A signed cookie carrying an expiry, not a session table. One deployment, one
 * business, one password - a database-backed session store would be a second
 * moving part guarding a single door.
 *
 * The cookie is `<expiresAtMs>.<hmac>`. There is no user identity in it because
 * there are no users: holding a valid cookie means "someone knew the password",
 * which is the entire access model.
 */

function signingKey(): string {
  const env = getEnv();

  // Falls back to the password so a deployment needs one secret rather than
  // two. Setting the secret separately lets sessions be revoked wholesale
  // without changing the password people type.
  const key = env.DASHBOARD_SESSION_SECRET ?? env.DASHBOARD_PASSWORD;

  if (!key) {
    throw new Error("DASHBOARD_PASSWORD is not set; refusing to issue a session");
  }

  return key;
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("hex");
}

/** Whether the dashboard is protected at all. False means it must not serve. */
export function isDashboardConfigured(): boolean {
  return getEnv().DASHBOARD_PASSWORD !== undefined;
}

/**
 * Constant-time password check. A plain `===` leaks the length of the matching
 * prefix through timing; this is the same reasoning as the webhook signature
 * comparison, and costs nothing.
 */
export function isCorrectPassword(candidate: string): boolean {
  const expected = getEnv().DASHBOARD_PASSWORD;
  if (!expected) return false;

  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);

  // timingSafeEqual throws on a length mismatch, so compare lengths first and
  // accept that the length itself is not hidden - it is not the secret.
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

export function createSessionValue(now: Date = new Date()): string {
  const expiresAt = now.getTime() + getEnv().DASHBOARD_SESSION_HOURS * 60 * 60 * 1000;
  const payload = String(expiresAt);

  return `${payload}.${sign(payload)}`;
}

/**
 * Whether a cookie value is a session this server issued and that has not
 * expired. Returns false for anything malformed rather than throwing - a
 * corrupted cookie is a login prompt, not a 500.
 */
export function isValidSessionValue(value: string | undefined, now: Date = new Date()): boolean {
  if (!value) return false;

  const separator = value.lastIndexOf(".");
  if (separator <= 0) return false;

  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);

  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;

  // Expiry is checked only after the signature, so an attacker cannot learn
  // anything by supplying a far-future timestamp.
  const expiresAt = Number.parseInt(payload, 10);
  if (!Number.isFinite(expiresAt)) return false;

  return expiresAt > now.getTime();
}

/** Cookie attributes. Shared so login and logout cannot drift apart. */
export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    // Secure in production only: the dev server is plain HTTP on localhost and
    // a Secure cookie would never be stored there.
    secure: process.env.NODE_ENV === "production",
    maxAge: maxAgeSeconds,
  };
}
