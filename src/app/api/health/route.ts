import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness and readiness for the platform.
 *
 * Deliberately queries the database rather than returning a bare 200. An
 * instance that cannot reach Postgres can serve no page and store no lead, so
 * reporting itself healthy would keep it in the load balancer swallowing
 * traffic - the failure mode this endpoint exists to prevent.
 *
 * Unauthenticated, and says almost nothing: up or down, and how long the check
 * took. No version, no host, no configuration - a health endpoint is a public
 * surface, and every field on it is something an attacker gets for free.
 */
export async function GET(): Promise<Response> {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;

    return Response.json(
      { status: "ok", databaseMs: Date.now() - startedAt },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch {
    // The reason is logged by Prisma, not returned: a connection error quotes
    // the connection string.
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
