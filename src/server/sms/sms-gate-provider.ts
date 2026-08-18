import { getEnv } from "@/config/env";
import type { SmsMessage, SmsProvider, SmsResult } from "./sms-provider";

/**
 * Sends through an SMS Gate (capcom6/android-sms-gateway) instance.
 *
 * Like TextBee this relays through a physical Android handset, so it carries
 * the same structural risk and is equally unsuitable as the client's
 * production path - a personal SIM cannot be registered for A2P 10DLC, and US
 * carriers filter unregistered automated business traffic.
 *
 * It is here because it is materially better for development. TextBee reported
 * "dispatched" and then nothing, so three messages that never left the handset
 * looked identical to three that arrived. SMS Gate reports real delivery state
 * per message (sent / delivered / failed), which turns that class of failure
 * from a guess into a fact.
 */

/**
 * Matches the TextBee timeout for the same reason: the request crosses a phone
 * that may be asleep or off wifi, and without a deadline the lead-intake
 * request stays open until the platform kills it.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/** Thrown for any non-2xx response or transport failure. */
export class SmsGateError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SmsGateError";
  }
}

/**
 * The API answers with the queued message's id. Read defensively - a missing id
 * must not fail a send the gateway actually accepted, because the message is
 * already on its way to the handset.
 */
function extractMessageId(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const root = payload as Record<string, unknown>;

    for (const key of ["id", "messageId", "message_id"]) {
      const value = root[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }

  return `sms-gate-unknown-${Date.now()}`;
}

/**
 * Strips the credentials from anything headed for an error message. Basic auth
 * sends them on every request, so a transport error can quote the whole header
 * back - and the routes serialise thrown messages into the logs.
 */
function redactCredentials(text: string, username: string, password: string): string {
  let safe = text;
  for (const secret of [password, username, Buffer.from(`${username}:${password}`).toString("base64")]) {
    if (secret.length > 0) safe = safe.split(secret).join("[redacted]");
  }
  return safe;
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    // Truncated: this is provider output and goes into logs.
    return text.slice(0, 300);
  } catch {
    return "<unreadable response body>";
  }
}

export const smsGateProvider: SmsProvider = {
  name: "sms-gate",

  async send(message: SmsMessage): Promise<SmsResult> {
    const { SMS_GATE_URL, SMS_GATE_USERNAME, SMS_GATE_PASSWORD } = getEnv();

    // getEnv() enforces these when SMS_PROVIDER=sms-gate; this narrows the type
    // and catches the provider being invoked directly with wrong configuration.
    if (!SMS_GATE_URL || !SMS_GATE_USERNAME || !SMS_GATE_PASSWORD) {
      throw new SmsGateError(
        "SMS_GATE_URL, SMS_GATE_USERNAME and SMS_GATE_PASSWORD must be configured",
      );
    }

    const url = `${SMS_GATE_URL.replace(/\/+$/, "")}/message`;
    const auth = Buffer.from(`${SMS_GATE_USERNAME}:${SMS_GATE_PASSWORD}`).toString("base64");

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({
          textMessage: { text: message.body },
          phoneNumbers: [message.to],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new SmsGateError(
        `SMS Gate request failed: ${redactCredentials(reason, SMS_GATE_USERNAME, SMS_GATE_PASSWORD)}`,
      );
    }

    if (!response.ok) {
      throw new SmsGateError(
        `SMS Gate rejected the message (HTTP ${response.status}): ` +
          redactCredentials(
            await readErrorDetail(response),
            SMS_GATE_USERNAME,
            SMS_GATE_PASSWORD,
          ),
        response.status,
      );
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // A 2xx with an unparseable body still means the gateway accepted it.
    }

    return {
      providerMessageId: extractMessageId(payload),
      provider: "sms-gate",
    };
  },
};
