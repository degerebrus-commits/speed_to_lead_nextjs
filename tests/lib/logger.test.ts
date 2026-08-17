import { describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/logger";

function capture(fn: () => void): Record<string, unknown> {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  fn();
  const line = spy.mock.calls[0]?.[0] as string;
  spy.mockRestore();
  return JSON.parse(line);
}

describe("logger redaction", () => {
  it("scrubs credentials", () => {
    const logged = capture(() =>
      logger.info("test", {
        apiKey: "sk-secret",
        webhookSecret: "shhh",
        password: "hunter2",
        authToken: "bearer-abc",
        token: "raw",
      }),
    );

    for (const key of ["apiKey", "webhookSecret", "password", "authToken", "token"]) {
      expect(logged[key], key).toBe("[redacted]");
    }
  });

  it("keeps token counts, which are metrics rather than credentials", () => {
    // Regression: a bare "token" substring match scrubbed these, which blinds
    // the cost accounting the SMS quota guard depends on.
    const logged = capture(() =>
      logger.info("test", { inputTokens: 1200, outputTokens: 48, totalTokens: 1248 }),
    );

    expect(logged.inputTokens).toBe(1200);
    expect(logged.outputTokens).toBe(48);
    expect(logged.totalTokens).toBe(1248);
  });

  it("leaves ordinary fields alone", () => {
    const logged = capture(() => logger.info("test", { leadId: "abc", provider: "anthropic" }));

    expect(logged.leadId).toBe("abc");
    expect(logged.provider).toBe("anthropic");
  });
});
