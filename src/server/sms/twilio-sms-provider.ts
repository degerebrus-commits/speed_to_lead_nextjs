import { getEnv } from "@/config/env";
import type { SmsMessage, SmsProvider, SmsResult } from "./sms-provider";

/**
 * Sends through Twilio.
 *
 * The only provider here that can carry a real deployment. TextBee and SMS Gate
 * both relay through an Android handset, which cannot be registered for A2P
 * 10DLC and which US carriers filter - and which failed to deliver at all on
 * the test device, twice, while reporting success.
 *
 * Written against the REST API with fetch rather than the twilio SDK. One
 * endpoint is involved, the other two providers are already plain fetch, and
 * CONTRIBUTING.md asks for minimal dependencies. If webhooks, media or the
 * Conversations API arrive later, the SDK earns its place then.
 */

const TWILIO_BASE_URL = "https://api.twilio.com/2010-04-01";

/**
 * Twilio is a hosted API rather than a phone on someone's desk, so this is a
 * network deadline rather than a "the handset might be asleep" allowance.
 */
const REQUEST_TIMEOUT_MS = 10_000;

export class TwilioError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TwilioError";
  }
}

/**
 * Strips the credentials from anything headed for an error message. Basic auth
 * sends them on every request, so a transport error can quote the header back,
 * and the routes serialise thrown messages into the logs.
 */
function redactCredentials(text: string, sid: string, token: string): string {
  let safe = text;
  for (const secret of [token, Buffer.from(`${sid}:${token}`).toString("base64")]) {
    if (secret.length > 0) safe = safe.split(secret).join("[redacted]");
  }
  return safe;
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 300);
  } catch {
    return "<unreadable response body>";
  }
}

export const twilioSmsProvider: SmsProvider = {
  name: "twilio",

  async send(message: SmsMessage): Promise<SmsResult> {
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = getEnv();

    // getEnv() enforces these when SMS_PROVIDER=twilio; this narrows the types
    // and catches the provider being called with the wrong configuration.
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
      throw new TwilioError(
        "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER must be configured",
      );
    }

    const url = `${TWILIO_BASE_URL}/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");

    // Form-encoded, not JSON. Twilio's REST API predates the convention and
    // rejects a JSON body outright.
    const body = new URLSearchParams({
      To: message.to,
      From: TWILIO_FROM_NUMBER,
      Body: message.body,
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${auth}`,
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new TwilioError(
        `Twilio request failed: ${redactCredentials(reason, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)}`,
      );
    }

    if (!response.ok) {
      // Twilio's errors are specific and worth surfacing intact - 21608 means
      // a trial account texting an unverified number, 21211 a malformed To,
      // 21610 a recipient who replied STOP. Guessing at these wastes an hour.
      throw new TwilioError(
        `Twilio rejected the message (HTTP ${response.status}): ` +
          redactCredentials(
            await readErrorDetail(response),
            TWILIO_ACCOUNT_SID,
            TWILIO_AUTH_TOKEN,
          ),
        response.status,
      );
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // A 2xx with an unparseable body still means Twilio queued it.
    }

    const sid =
      payload && typeof payload === "object" && typeof (payload as { sid?: unknown }).sid === "string"
        ? (payload as { sid: string }).sid
        : `twilio-unknown-${Date.now()}`;

    return { providerMessageId: sid, provider: "twilio" };
  },
};
