import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { isValidTwilioSignature } from "@/lib/twilio-signature";

const TOKEN = "twilio-auth-token-0123456789abcdef";
const URL_CONFIGURED = "https://example.test/api/webhooks/twilio";

/** Builds what Twilio would send, so the test signs the way Twilio signs. */
function signLikeTwilio(url: string, params: Record<string, string>, token: string): string {
  const payload =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join("");

  return createHmac("sha1", token).update(Buffer.from(payload, "utf8")).digest("base64");
}

const PARAMS = {
  From: "+639534305571",
  To: "+15550001111",
  Body: "Can you send someone out?",
  MessageSid: "SM0123456789abcdef",
};

describe("Twilio signature verification", () => {
  it("accepts a correctly signed request", () => {
    const signature = signLikeTwilio(URL_CONFIGURED, PARAMS, TOKEN);

    expect(isValidTwilioSignature(URL_CONFIGURED, PARAMS, signature, TOKEN)).toBe(true);
  });

  it("rejects a missing signature", () => {
    expect(isValidTwilioSignature(URL_CONFIGURED, PARAMS, null, TOKEN)).toBe(false);
  });

  it("rejects a signature made with a different token", () => {
    const signature = signLikeTwilio(URL_CONFIGURED, PARAMS, "someone-elses-token-000000000000");

    expect(isValidTwilioSignature(URL_CONFIGURED, PARAMS, signature, TOKEN)).toBe(false);
  });

  it("rejects when the body has been tampered with", () => {
    const signature = signLikeTwilio(URL_CONFIGURED, PARAMS, TOKEN);
    const altered = { ...PARAMS, Body: "cancel my appointment" };

    // The whole point: an attacker changing what the customer said must not
    // be able to keep a valid signature.
    expect(isValidTwilioSignature(URL_CONFIGURED, altered, signature, TOKEN)).toBe(false);
  });

  it("rejects when the URL differs, because the URL is signed too", () => {
    const signature = signLikeTwilio("https://example.test/api/webhooks/other", PARAMS, TOKEN);

    expect(isValidTwilioSignature(URL_CONFIGURED, PARAMS, signature, TOKEN)).toBe(false);
  });

  it("is insensitive to the order parameters arrive in", () => {
    // Twilio sorts by name, so a reordered body is the same request.
    const reordered = {
      MessageSid: PARAMS.MessageSid,
      Body: PARAMS.Body,
      To: PARAMS.To,
      From: PARAMS.From,
    };
    const signature = signLikeTwilio(URL_CONFIGURED, PARAMS, TOKEN);

    expect(isValidTwilioSignature(URL_CONFIGURED, reordered, signature, TOKEN)).toBe(true);
  });

  it("rejects everything when no auth token is configured", () => {
    const signature = signLikeTwilio(URL_CONFIGURED, PARAMS, TOKEN);

    // Failing closed: an unverifiable receiver must reject, not accept.
    expect(isValidTwilioSignature(URL_CONFIGURED, PARAMS, signature, "")).toBe(false);
  });

  it("rejects a signature of the wrong length without throwing", () => {
    expect(() => isValidTwilioSignature(URL_CONFIGURED, PARAMS, "short", TOKEN)).not.toThrow();
    expect(isValidTwilioSignature(URL_CONFIGURED, PARAMS, "short", TOKEN)).toBe(false);
  });
});
