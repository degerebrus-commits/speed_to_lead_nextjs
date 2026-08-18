import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE, isDashboardConfigured, isValidSessionValue } from "./session";

/**
 * Guards a dashboard page. Call it first in every protected page.
 *
 * The middleware only checks that a cookie exists, because it runs on the Edge
 * runtime where node:crypto is unavailable. This is where the signature is
 * actually verified, so a forged or expired cookie gets past the redirect and
 * is rejected here.
 *
 * Called per page rather than from the root layout: the layout also wraps
 * /login, and redirecting from there would loop.
 */
export async function requireSession(returnTo?: string): Promise<void> {
  // No password configured means the dashboard must not serve at all. Failing
  // closed is the only safe default for a screen holding customer addresses.
  if (!isDashboardConfigured()) redirect("/login");

  const store = await cookies();

  if (!isValidSessionValue(store.get(SESSION_COOKIE)?.value)) {
    const target = returnTo && returnTo !== "/" ? `?next=${encodeURIComponent(returnTo)}` : "";
    redirect(`/login${target}`);
  }
}
