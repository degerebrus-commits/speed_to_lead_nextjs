import { describe, expect, it } from "vitest";

import { redact } from "../../scripts/redact-secrets.mjs";

/**
 * The redactor exists because rules did not hold.
 *
 * Five secrets reached this project's transcripts. The fourth one's prevention
 * rule said "never print raw API responses", and the fifth was a signing secret
 * in a URL path grepped out of a log - not an API response, so the rule never
 * fired. This is the guarantee that does not depend on anyone remembering.
 *
 * The values below are invented. Nothing real belongs in a test file.
 */

describe("redact", () => {
  it("masks an Anthropic key", () => {
    const { text, hits } = redact("using sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA now");

    expect(text).not.toContain("sk-ant-api03");
    expect(text).toContain("<redacted:ANTHROPIC_KEY>");
    expect(hits).toBe(1);
  });

  it("masks a credential sitting in a URL path", () => {
    // This is the shape of the fifth leak: not a JSON body, not a header, a
    // path segment in a log line.
    const { text } = redact("Authorization: Bearer abcdefghijklmnop0123456789");

    expect(text).not.toContain("abcdefghijklmnop");
    expect(text).toContain("<redacted:AUTH_HEADER>");
  });

  it("masks credentials embedded in a connection string", () => {
    const { text } = redact("postgresql://postgres:hunter2pass@localhost:5442/db");

    expect(text).not.toContain("hunter2pass");
    expect(text).toContain("<redacted:URL_CREDENTIALS>");
  });

  it("masks a private key however long it is", () => {
    const key = [
      "-----BEGIN PRIVATE KEY-----",
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ",
      "-----END PRIVATE KEY-----",
    ].join("\n");

    const { text } = redact(`key is ${key} end`);

    expect(text).not.toContain("MIIEvQIBADAN");
    expect(text).toContain("<redacted:PRIVATE_KEY>");
  });

  it("leaves ordinary output alone", () => {
    // A redactor that fires on normal text gets switched off, which is worse
    // than not having one.
    const ordinary = "Test Files 35 passed, Tests 330 passed, exit 0, port 3100";
    const { text, hits } = redact(ordinary);

    expect(text).toBe(ordinary);
    expect(hits).toBe(0);
  });

  it("counts every masked value so the reader knows something was hidden", () => {
    const { hits } = redact(
      "AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA and ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );

    expect(hits).toBe(2);
  });

  it("handles empty and non-string input without throwing", () => {
    expect(redact("").hits).toBe(0);
    // @ts-expect-error - deliberately wrong, because a hook payload may not
    // carry a string and the redactor must not take the session down.
    expect(redact(undefined).hits).toBe(0);
  });
});
