import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getBusinessProfile } from "@/config/business";
import { getEnv } from "@/config/env";
import { logger } from "@/lib/logger";
import {
  SESSION_COOKIE,
  createSessionValue,
  isCorrectPassword,
  isDashboardConfigured,
  sessionCookieOptions,
} from "@/server/auth/session";

export const dynamic = "force-dynamic";

/**
 * Only ever returns a path on this site. A `next` parameter is attacker-supplied
 * - anyone can send a link - so a value like "//evil.example.com" must not
 * survive into a redirect.
 */
function safeNext(value: string | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  return value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const business = getBusinessProfile();

  if (!isDashboardConfigured()) {
    return (
      <>
        <h2>Dashboard is not configured</h2>
        <div className="notice notice-bad" role="alert">
          <h3>No dashboard password is set, so nothing will be served.</h3>
          <p>
            This screen shows every customer&rsquo;s name, phone number, home
            address and message history, so it fails closed rather than opening
            to anyone who finds the address. Set <code>DASHBOARD_PASSWORD</code>{" "}
            in <code>.env</code> (at least 12 characters) and restart the server.
          </p>
        </div>
      </>
    );
  }

  async function authenticate(formData: FormData) {
    "use server";

    const submitted = formData.get("password");
    const target = safeNext(String(formData.get("next") ?? "/"));

    if (typeof submitted !== "string" || !isCorrectPassword(submitted)) {
      // The attempt is logged, the value never is.
      logger.warn("Dashboard login failed");
      redirect(`/login?error=1${target === "/" ? "" : `&next=${encodeURIComponent(target)}`}`);
    }

    const store = await cookies();
    store.set(
      SESSION_COOKIE,
      createSessionValue(),
      sessionCookieOptions(getEnv().DASHBOARD_SESSION_HOURS * 60 * 60),
    );

    logger.info("Dashboard login succeeded");
    redirect(target);
  }

  return (
    <>
      <h2>Sign in</h2>
      <p className="subtitle">{business.name} lead assistant.</p>

      {params.error ? (
        <div className="notice notice-bad" role="alert">
          <h3>That password was not correct.</h3>
          <p>Check for a stray space, then try again.</p>
        </div>
      ) : null}

      <form action={authenticate} className="card" style={{ maxWidth: "380px" }}>
        <input type="hidden" name="next" value={next} />

        <label htmlFor="password" className="metric-label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          style={{
            display: "block",
            width: "100%",
            padding: "9px 11px",
            margin: "6px 0 14px",
            font: "inherit",
            borderRadius: "8px",
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
          }}
        />

        <button type="submit" className="button">
          Sign in
        </button>
      </form>
    </>
  );
}
