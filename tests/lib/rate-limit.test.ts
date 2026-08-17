import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, pruneRateLimitWindows, resetRateLimits } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows requests up to the limit and blocks the one after", () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(checkRateLimit("1.2.3.4", 3, 60_000).allowed, `attempt ${attempt}`).toBe(true);
    }

    const blocked = checkRateLimit("1.2.3.4", 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts each caller separately", () => {
    checkRateLimit("1.1.1.1", 1, 60_000);
    expect(checkRateLimit("1.1.1.1", 1, 60_000).allowed).toBe(false);
    expect(checkRateLimit("2.2.2.2", 1, 60_000).allowed).toBe(true);
  });

  it("lets a caller back in once the window has elapsed", async () => {
    expect(checkRateLimit("3.3.3.3", 1, 20).allowed).toBe(true);
    expect(checkRateLimit("3.3.3.3", 1, 20).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(checkRateLimit("3.3.3.3", 1, 20).allowed).toBe(true);
  });

  it("prunes expired windows so the map cannot grow without bound", async () => {
    checkRateLimit("4.4.4.4", 1, 10);
    await new Promise((resolve) => setTimeout(resolve, 20));

    pruneRateLimitWindows();

    // A pruned caller starts a fresh window, so it is allowed again.
    expect(checkRateLimit("4.4.4.4", 1, 10).allowed).toBe(true);
  });
});
