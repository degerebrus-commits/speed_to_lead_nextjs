import { afterAll, beforeEach } from "vitest";
import { config as loadDotenv } from "dotenv";

// Vitest does not read .env, so load it explicitly. Tests then follow whatever
// port, credentials and business identity this deployment is configured with,
// rather than assuming defaults that would break on the next client.
loadDotenv({ path: ".env" });

/**
 * Tests get their own database, derived from the configured one by suffixing
 * _test. docker/initdb/01-create-test-database.sh creates it on first start.
 * Set TEST_DATABASE_URL to override.
 */
function deriveTestDatabaseUrl(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);

  if (!parsed.pathname.endsWith("_test")) {
    parsed.pathname = `${parsed.pathname}_test`;
  }

  // Prisma sizes its pool at (cpus * 2 + 1) and gives up after five seconds of
  // waiting for a connection. getDashboardMetrics issues five queries in one
  // Promise.all, and with the whole suite in a single fork that was enough to
  // exhaust the pool - failures landed at 5.1-5.3s, which is the pool timeout,
  // not vitest's. Postgres allows 100 connections and the suite was using 11.
  parsed.searchParams.set("connection_limit", "25");
  parsed.searchParams.set("pool_timeout", "20");

  return parsed.toString();
}

const configuredUrl =
  process.env.TEST_DATABASE_URL ??
  deriveTestDatabaseUrl(
    process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/hvac_leads",
  );

// Set before importing anything that reads configuration: the Prisma client is
// built from DATABASE_URL at module load.
process.env.DATABASE_URL = configuredUrl;

// Deliberately NOT the values in .env.example. If the suite passes with these,
// the code is reading configuration rather than a hardcoded literal - which is
// the point of the template design.
process.env.LEAD_WEBHOOK_SECRET = "test-webhook-secret-0123456789";
process.env.BUSINESS_NAME = "Northwind Heating & Air";
process.env.BUSINESS_COUNTRY_CODE = "+1";
process.env.SMS_PROVIDER = "console";
process.env.TEXTBEE_WEBHOOK_SECRET = "test-webhook-signing-secret-0123456789";
process.env.RATE_LIMIT_MAX_REQUESTS = "1000";
process.env.RATE_LIMIT_WINDOW_MS = "60000";
// SMS_INTRO_TEMPLATE is left unset so the suite exercises the shipped default.
delete process.env.SMS_INTRO_TEMPLATE;

/**
 * Cuts the suite off from Google.
 *
 * Called from beforeEach rather than at module scope, and that placement is
 * the whole point: deleting these at the top of this file does not hold.
 * Vitest loads .env through Vite after setup modules are evaluated, which put
 * the real service account back before a single test ran - so the booking
 * specs were quietly making live Calendar API calls against the business's
 * real calendar, and its 19 real events were filtering the offered slots down
 * to nothing. The symptom was three unrelated specs failing on availability.
 *
 * Empty string rather than delete, because that is what env.ts treats as
 * unset and it survives a reload that a delete does not.
 *
 * A spec that wants the calendar path installs its own fetch double.
 */
function isolateFromGoogle(): void {
  process.env.GOOGLE_CLIENT_EMAIL = "";
  process.env.GOOGLE_PRIVATE_KEY = "";
  process.env.GOOGLE_CALENDAR_ID = "";
}

// These tests truncate tables. Refuse to touch a database that is not visibly a
// test database - the seeded development data is one connection string away and
// would be destroyed silently.
if (!/_test(\b|\?|$)/.test(process.env.DATABASE_URL)) {
  throw new Error(
    `Refusing to run tests: DATABASE_URL does not name a *_test database (${process.env.DATABASE_URL})`,
  );
}

const { prisma } = await import("@/lib/db");
const { resetRateLimits } = await import("@/lib/rate-limit");
const { setSmsProviderForTesting } = await import("@/server/sms/sms-service");
const { setAiProviderForTesting } = await import("@/server/ai/ai-service");
const { randomUUID } = await import("node:crypto");

const { resetEnvCache } = await import("@/config/env");

beforeEach(async () => {
  isolateFromGoogle();
  // The cache is what the code actually reads; clearing the variables without
  // this leaves a previously parsed configuration in place.
  resetEnvCache();

  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Appointment", "Message", "Lead" RESTART IDENTITY CASCADE');
  resetRateLimits();

  // Default doubles for both outbound paths. A spec that cares installs its
  // own; every other spec is guaranteed never to touch a paid API.
  setSmsProviderForTesting({
    name: "default-test-sms",
    async send() {
      // Unique per call: providerMessageId is a unique column, and a fixed id
      // would make the second send of any test fail on a constraint.
      return { providerMessageId: `test-${randomUUID()}`, provider: "default-test-sms" };
    },
  });

  setAiProviderForTesting({
    name: "default-test-ai",
    model: "stub",
    async complete() {
      return {
        text: "Got it - can you tell me a bit more about the issue?",
        model: "stub",
        provider: "default-test-ai",
        inputTokens: null,
        outputTokens: null,
      };
    },
  });
});

afterAll(async () => {
  // Deliberately does NOT disconnect.
  //
  // setupFiles run once per test file, and vitest.config.ts pins the whole
  // suite to a single fork, so this hook fires after every file against the
  // same client - tearing down the connection pool two dozen times mid-run.
  // The next file's first queries then raced the reconnect and timed out,
  // which presented as a different test failing in roughly one run in three.
  //
  // The pool is released when the process exits, which is the moment the suite
  // is over anyway.
});
