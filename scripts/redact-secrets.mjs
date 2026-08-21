#!/usr/bin/env node
/**
 * Redacts secrets out of tool output before it reaches the transcript.
 *
 * Wired as a PostToolUse hook on Bash. It exists because a written rule is a
 * request and this is a guarantee: five secrets leaked into this project's
 * transcripts, and the fourth one's prevention rule - "never print raw API
 * responses" - did not fire for the fifth, which was a signing secret sitting
 * in a URL path grepped out of a log file.
 *
 * Two sources of truth, deliberately:
 *
 *   1. The literal values in .env. Anything the deployment actually treats as
 *      a secret is masked wherever it appears, in any shape - JSON body, URL
 *      path, query string, log line, error message.
 *   2. Patterns, for credentials that never passed through .env: another
 *      account's key pasted into a command, a token from an API response.
 *
 * Reads a hook payload on stdin and writes the redacted text back out. Fails
 * open on any error - a broken redactor must not block the session, and the
 * failure is announced rather than swallowed.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(HERE);

/** Keys whose values are secret. Substring match, so TWILIO_AUTH_TOKEN counts. */
const SECRET_KEY_HINTS = [
  "SECRET",
  "TOKEN",
  "PASSWORD",
  "API_KEY",
  "PRIVATE_KEY",
  "CREDENTIAL",
  "DATABASE_URL",
];

/**
 * Values too short or too common to mask safely.
 *
 * Masking "true" or "8080" would redact half of every output and teach the
 * reader to ignore the marker. A secret worth protecting is longer than this.
 *
 * Twelve, not eight, and a test found the reason: the dev POSTGRES_PASSWORD is
 * the word "postgres", so an eight-character floor masked it inside
 * "postgresql://" and mangled every connection string in the output. Twelve is
 * also the minimum the schema already enforces on DASHBOARD_PASSWORD, so a
 * value below it is not a credential this project takes seriously.
 */
const MIN_SECRET_LENGTH = 12;

function literalSecrets() {
  let raw;
  try {
    raw = readFileSync(join(PROJECT_ROOT, ".env"), "utf8");
  } catch {
    return [];
  }

  const found = [];

  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (!SECRET_KEY_HINTS.some((hint) => key.includes(hint))) continue;

    let value = rawValue.trim();
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    if (value.length < MIN_SECRET_LENGTH) continue;

    found.push({ key, value });

    // A private key arrives with escaped newlines in .env and real ones in
    // memory. Mask both spellings, or the decoded form walks straight past.
    if (value.includes("\\n")) {
      found.push({ key, value: value.split("\\n").join("\n") });
    }
  }

  // Longest first, so a secret containing another is masked whole.
  return found.sort((a, b) => b.value.length - a.value.length);
}

/**
 * Shapes that are credentials wherever they came from.
 *
 * Deliberately narrow. A pattern that fires on ordinary text gets the whole
 * redactor turned off, which is worse than not having one.
 */
const PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/g, "ANTHROPIC_KEY"],
  [/sk-[A-Za-z0-9]{32,}/g, "API_KEY"],
  [/AC[0-9a-f]{32}/g, "TWILIO_SID"],
  [/AIza[0-9A-Za-z_-]{35}/g, "GOOGLE_KEY"],
  [/gh[pousr]_[A-Za-z0-9]{30,}/g, "GITHUB_TOKEN"],
  [/-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g, "PRIVATE_KEY"],
  // A bearer token or basic-auth credential in a header.
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi, "AUTH_HEADER"],
  // Credentials in a URL, which is where the fifth leak lived.
  [/:\/\/[^\s:/@]+:[^\s:/@]+@/g, "URL_CREDENTIALS"],
];

export function redact(text) {
  if (typeof text !== "string" || text.length === 0) return { text, hits: 0 };

  let out = text;
  let hits = 0;

  for (const { key, value } of literalSecrets()) {
    if (!out.includes(value)) continue;
    out = out.split(value).join(`<redacted:${key}>`);
    hits += 1;
  }

  for (const [pattern, label] of PATTERNS) {
    out = out.replace(pattern, () => {
      hits += 1;
      return `<redacted:${label}>`;
    });
  }

  return { text: out, hits };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const input = await readStdin();
  if (!input.trim()) return;

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    // Not a payload we understand. Say so and change nothing, rather than
    // guessing at the shape and mangling the output.
    process.stderr.write("redact-secrets: unrecognised hook payload; passing through\n");
    return;
  }

  const original =
    payload?.tool_response?.stdout ??
    payload?.tool_response?.output ??
    payload?.tool_result ??
    "";

  const { text, hits } = redact(String(original));

  if (hits === 0) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext:
          `redact-secrets masked ${hits} secret value(s) in this output. ` +
          `The masked text follows; do not attempt to recover the originals.\n\n${text}`,
      },
    }),
  );
}

// Fails open. A redactor that blocks the session is worse than one that misses,
// but a silent failure is worse than both - so the error is announced.
main().catch((error) => {
  process.stderr.write(`redact-secrets failed, output not masked: ${error.message}\n`);
  process.exit(0);
});
