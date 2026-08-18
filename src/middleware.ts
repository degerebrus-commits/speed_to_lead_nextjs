import { NextResponse, type NextRequest } from "next/server";

// From session-cookie, not session: this file runs on the Edge runtime and
// session.ts imports node:crypto, which is unavailable there.
import { SESSION_COOKIE } from "@/server/auth/session-cookie";

/**
 * Gate on the dashboard.
 *
 * Deliberately does NOT verify the cookie signature here. Middleware runs on
 * the Edge runtime, where node:crypto is unavailable, so this checks only that
 * a cookie is present and redirects when it is not. The real verification
 * happens in the layout, which runs on Node - a forged cookie gets past this
 * redirect and is rejected there.
 *
 * The API routes are excluded: they authenticate with their own shared secret
 * and HMAC signatures, and a browser session means nothing to a webhook.
 */
export function middleware(request: NextRequest) {
  const hasCookie = request.cookies.has(SESSION_COOKIE);

  if (!hasCookie) {
    const loginUrl = new URL("/login", request.url);

    // Preserve where they were heading so the login can return them to it,
    // path only - a full URL here would be an open redirect.
    const target = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    if (target !== "/") loginUrl.searchParams.set("next", target);

    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   api           - authenticated by shared secret / HMAC, not a session
     *   login         - the door itself
     *   demo          - public by design; guarded by DEMO_FORM_ENABLED and a
     *                   rate limit rather than a password
     *   _next, favicon - framework and static assets
     */
    "/((?!api|login|demo|_next/static|_next/image|favicon.ico).*)",
  ],
};
