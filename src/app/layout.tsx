import type { Metadata } from "next";
import Link from "next/link";

import { getBusinessProfile } from "@/config/business";

import "./globals.css";

/**
 * The business name is configuration, never a literal - a new client
 * deployment changes .env and nothing else (CONTRIBUTING.md).
 */
export function generateMetadata(): Metadata {
  const business = getBusinessProfile();

  return {
    title: `${business.name} — Lead Assistant`,
    description: `Lead response and booking dashboard for ${business.name}.`,
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const business = getBusinessProfile();

  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <h1>{business.name}</h1>
          <nav aria-label="Main">
            <Link href="/">Dashboard</Link>
            <Link href="/leads">Leads</Link>
          </nav>

          {/* POST, not a link: a GET logout would fire on prefetch. */}
          <form action="/logout" method="post" style={{ marginLeft: "auto" }}>
            <button type="submit" className="link-button">
              Sign out
            </button>
          </form>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
