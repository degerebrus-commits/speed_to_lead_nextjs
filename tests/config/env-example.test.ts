import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENV_KEYS } from "@/config/env";

/**
 * Lists that must agree with nothing enforcing it. A key added to one place and
 * not the other breaks the next client deployment at startup, and no
 * behavioural test would catch it - so the lists are compared directly.
 *
 * .env.example carries two kinds of key: those the application reads, and those
 * only docker-compose reads. The marker below separates them.
 */
const INFRA_SECTION_MARKER = "# --- docker-compose only";

const projectRoot = path.resolve(__dirname, "../..");
const raw = readFileSync(path.join(projectRoot, ".env.example"), "utf8");
const compose = readFileSync(path.join(projectRoot, "docker-compose.yml"), "utf8");

function keysIn(section: string): string[] {
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.split("=")[0]?.trim())
    .filter((key): key is string => Boolean(key))
    .sort();
}

const markerIndex = raw.indexOf(INFRA_SECTION_MARKER);
const applicationSection = markerIndex === -1 ? raw : raw.slice(0, markerIndex);
const infraSection = markerIndex === -1 ? "" : raw.slice(markerIndex);

describe(".env.example", () => {
  it("has the docker-compose section marker the other assertions depend on", () => {
    expect(markerIndex).toBeGreaterThan(-1);
  });

  it("documents exactly the keys the application requires", () => {
    expect(keysIn(applicationSection)).toEqual([...ENV_KEYS]);
  });

  it("documents only infrastructure keys that docker-compose actually reads", () => {
    const infraKeys = keysIn(infraSection);
    expect(infraKeys.length).toBeGreaterThan(0);

    for (const key of infraKeys) {
      expect(compose, `${key} is documented but unused by docker-compose.yml`).toContain(
        `\${${key}`,
      );
    }
  });

  it("carries no real credentials", () => {
    // A readable placeholder is fine; a long hex blob is a leaked secret.
    expect(raw).not.toMatch(/[a-f0-9]{32,}/i);
  });
});
