import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    // Integration tests share one Postgres database and truncate between
    // cases, so they must not run in parallel across worker processes.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    /**
     * Above vitest's 5s default. These are integration tests against a real
     * Postgres in Docker, and getDashboardMetrics alone issues five concurrent
     * queries - on a loaded machine that intermittently crossed 5s and failed
     * a different test each time, which looked like flakiness rather than the
     * timeout it was.
     */
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
