import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies Twilio's X-Twilio-Signature header.
 *
 * Twilio signs differently from every other gateway here. Rather than an HMAC
 * over the raw body, it builds a string from the full request URL followed by
 * every POST parameter in alphabetical order, name then value with no
 * separators, and signs that with the account's auth token - the same secret
 * used to authenticate outbound calls.
 *
 * Documented at https://www.twilio.com/docs/usage/security#validating-requests
 *
 * The URL is part of what is signed, which is why the value passed here must be
 * exactly the URL Twilio was configured with - scheme, host and path. Behind a
 * proxy the host the app sees is not the host Twilio called, so it is supplied
 * from configuration rather than read off the request.
 */
export function isValidTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null,
  authToken: string,
): boolean {
  if (!signature || authToken.length === 0) return false;

  // URL first, then each parameter sorted by name, concatenated without
  // separators. Order is the whole point - a different order is a different
  // signature.
  const payload =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join("");

  const expected = createHmac("sha1", authToken).update(Buffer.from(payload, "utf8")).digest("base64");

  const provided = Buffer.from(signature, "utf8");
  const computed = Buffer.from(expected, "utf8");

  // Compare lengths first: timingSafeEqual throws on a mismatch, and the length
  // is not the secret.
  if (provided.length !== computed.length) return false;

  return timingSafeEqual(provided, computed);
}
