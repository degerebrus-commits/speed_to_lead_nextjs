import { createSign } from "node:crypto";

import { getEnv } from "@/config/env";

/**
 * Mints a Google access token from a service account.
 *
 * Hand-rolled rather than pulling in googleapis. The flow is a signed JWT
 * exchanged for a bearer token, which is thirty lines of node:crypto, and the
 * SDK is tens of megabytes for two endpoints. CONTRIBUTING.md asks for minimal
 * dependencies and the SMS providers are already plain fetch.
 *
 * A service account avoids an OAuth consent flow entirely: the business shares
 * its calendar with the account's email address, and no user ever signs in.
 * That matters for a system that runs unattended.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";

/** Tokens last an hour; refreshed a minute early so a request cannot race it. */
const TOKEN_LIFETIME_SECONDS = 3600;
const REFRESH_MARGIN_MS = 60_000;

export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

let cached: { token: string; expiresAt: number } | null = null;

/** Test-only. Configuration changes between specs. */
export function resetGoogleTokenCache(): void {
  cached = null;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Restores the newlines in a private key read from an environment variable.
 *
 * A PEM key is multi-line, and .env files are not, so the key is stored with
 * literal backslash-n sequences. Left unconverted the signature fails with an
 * error that says nothing useful about why.
 */
export function decodePrivateKey(raw: string): string {
  return raw.includes("-----BEGIN") ? raw.replace(/\\n/g, "\n") : raw;
}

export async function getGoogleAccessToken(now: number = Date.now()): Promise<string> {
  if (cached && cached.expiresAt > now + REFRESH_MARGIN_MS) return cached.token;

  const { GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY } = getEnv();

  if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new GoogleAuthError("GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY must be configured");
  }

  const issuedAt = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: GOOGLE_CLIENT_EMAIL,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + TOKEN_LIFETIME_SECONDS,
    }),
  );

  let signature: string;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claims}`);
    signature = base64url(signer.sign(decodePrivateKey(GOOGLE_PRIVATE_KEY)));
  } catch (error) {
    // The key itself must never reach a log or an error message.
    throw new GoogleAuthError(
      `Could not sign the service account assertion - check GOOGLE_PRIVATE_KEY is a valid PEM: ${
        error instanceof Error ? error.name : "unknown error"
      }`,
    );
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "<unreadable>");
    throw new GoogleAuthError(
      `Google refused the service account assertion (HTTP ${response.status}): ${detail.slice(0, 200)}`,
    );
  }

  const payload = (await response.json()) as { access_token?: string; expires_in?: number };

  if (!payload.access_token) {
    throw new GoogleAuthError("Google returned no access token");
  }

  cached = {
    token: payload.access_token,
    expiresAt: now + (payload.expires_in ?? TOKEN_LIFETIME_SECONDS) * 1000,
  };

  return cached.token;
}
