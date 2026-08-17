import { PrismaClient } from "@prisma/client";

/**
 * Next.js hot-reloads modules in development, which would construct a new
 * PrismaClient - and a new connection pool - on every edit until Postgres
 * refuses further connections. Caching on globalThis survives the reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
