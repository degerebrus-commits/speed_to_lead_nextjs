import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger, resetSecretCache } from "@/lib/logger";

const ORIGINAL = { ...process.env };

/** Captures what would actually reach stdout. */
function captureLog(run: () => void): string {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((line) => lines.push(String(line)));
  const info = vi.spyOn(console, "log").mockImplementation((line) => lines.push(String(line)));
  try {
    run();
  } finally {
    spy.mockRestore();
    info.mockRestore();
  }
  return lines.join("\n");
}

const SECRET = "super-secret-webhook-value-9f3a";
const FAKE_DSN = `postgresql://postgres:${SECRET}@localhost:5442/hvac_leads`;

/**
 * Deliberately does NOT touch DATABASE_URL, even though a leaked connection
 * string is the case this guards. Prisma reads that variable when the client is
 * constructed, so changing it here poisoned whichever test file imported the
 * database next - the analytics suite failed with connection timeouts while
 * passing in isolation.
 *
 * LEAD_WEBHOOK_SECRET carries the secret instead, and FAKE_DSN embeds it so the
 * assertion still exercises "a credential inside a connection string inside an
 * error message".
 */
beforeEach(() => {
  process.env.LEAD_WEBHOOK_SECRET = SECRET;
  process.env.ANTHROPIC_API_KEY = "sk-ant-abcdefghijklmnop";
  resetSecretCache();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  resetSecretCache();
});

describe("log redaction", () => {
  it("scrubs a secret out of an error message logged under an innocent key", () => {
    // The real leak: every route logs `reason: error.message`, and "reason" is
    // not a sensitive key name, so a Prisma error quoting the connection string
    // passed through in full.
    const output = captureLog(() => {
      logger.error("Database unreachable", {
        reason: `Can't reach database server at ${FAKE_DSN}`,
      });
    });

    expect(output).not.toContain(SECRET);
    expect(output).toContain("[redacted]");
  });

  it("scrubs secrets nested inside an object", () => {
    const output = captureLog(() => {
      logger.error("Startup failed", { config: { databaseUrl: FAKE_DSN } });
    });

    // Previously the redactor only looked at the top level, so anything one
    // object deep was logged verbatim.
    expect(output).not.toContain(SECRET);
  });

  it("scrubs an Error object's message, which is not enumerable", () => {
    const output = captureLog(() => {
      logger.error("Boom", { err: new Error(`connect failed: ${process.env.ANTHROPIC_API_KEY}`) });
    });

    expect(output).not.toContain("sk-ant-abcdefghijklmnop");
  });

  it("still redacts by key name", () => {
    const output = captureLog(() => {
      logger.error("Auth", { apiKey: "whatever-this-is", password: "hunter2" });
    });

    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("whatever-this-is");
  });

  it("keeps token counts, which are cost accounting rather than credentials", () => {
    const output = captureLog(() => {
      logger.info("AI call", { inputTokens: 412, outputTokens: 88 });
    });

    // Redaction that is too broad fails silently and looks like success.
    expect(output).toContain("412");
    expect(output).toContain("88");
  });

  it("does not throw on a cyclic object", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;

    expect(() => captureLog(() => logger.info("Cycle", { cyclic }))).not.toThrow();
  });

  it("leaves ordinary text alone", () => {
    const output = captureLog(() => {
      logger.info("Lead stored", { leadId: "abc123", phone: "+15551234567" });
    });

    expect(output).toContain("abc123");
    expect(output).toContain("+15551234567");
  });
});
