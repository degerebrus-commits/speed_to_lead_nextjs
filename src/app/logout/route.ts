import { cookies } from "next/headers";

import { SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/session";

export const runtime = "nodejs";

/**
 * Ends the session.
 *
 * POST rather than GET: a GET would let any page log the user out with an
 * <img src="/logout">, and browsers prefetch links.
 */
export async function POST(request: Request): Promise<Response> {
  const store = await cookies();

  // Overwritten with an expired cookie rather than deleted, so the browser is
  // told to drop it even if a stale copy exists.
  store.set(SESSION_COOKIE, "", sessionCookieOptions(0));

  return Response.redirect(new URL("/login", request.url), 303);
}
