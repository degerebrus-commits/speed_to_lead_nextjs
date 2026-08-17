import { getEnv } from "@/config/env";
import type { SmsMessage, SmsProvider, SmsResult } from "./sms-provider";

const TEXTBEE_BASE_URL = "https://api.textbee.dev/api/v1";

/**
 * How long to wait on the gateway before giving up.
 *
 * TextBee relays through a physical Android handset, so a flat battery or a
 * phone off wifi shows up as a request that never answers. Without a deadline
 * that would hold the lead-intake request open until the platform killed it.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/** Thrown for any non-2xx response or transport failure. */
export class TextBeeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TextBeeError";
  }
}

/**
 * The response body is not documented beyond "2XX means accepted", so the id is
 * read defensively from the shapes their API is known to return and falls back
 * to a synthetic value. A missing id must not fail a send that actually
 * succeeded.
 */
function extractMessageId(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const root = payload as Record<string, unknown>;
    const data = (root.data ?? root) as Record<string, unknown>;

    for (const key of ["messageId", "smsBatchId", "_id", "id"]) {
      const value = data[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }

  return `textbee-unknown-${Date.now()}`;
}

/**
 * Strips the API key from anything headed for an error message. The key is sent
 * on every request, so an underlying transport error can quote it back - and
 * the route serialises thrown messages into the logs.
 */
function redactApiKey(text: string, apiKey: string): string {
  return apiKey.length > 0 ? text.split(apiKey).join("[redacted]") : text;
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    // Truncated: the body is provider output and goes into logs.
    return text.slice(0, 300);
  } catch {
    return "<unreadable response body>";
  }
}

/**
 * Sends through a TextBee-connected Android device.
 *
 * Used for testing. The client's own Twilio account replaces this for
 * production, which is why nothing outside this file knows the difference.
 */
export const textBeeSmsProvider: SmsProvider = {
  name: "textbee",

  async send(message: SmsMessage): Promise<SmsResult> {
    const { TEXTBEE_API_KEY, TEXTBEE_DEVICE_ID } = getEnv();

    // getEnv() enforces these when SMS_PROVIDER=textbee; this narrows the type
    // and catches a provider invoked directly with the wrong configuration.
    if (!TEXTBEE_API_KEY || !TEXTBEE_DEVICE_ID) {
      throw new TextBeeError("TEXTBEE_API_KEY and TEXTBEE_DEVICE_ID must be configured");
    }

    const url = `${TEXTBEE_BASE_URL}/gateway/devices/${TEXTBEE_DEVICE_ID}/send-sms`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": TEXTBEE_API_KEY,
        },
        body: JSON.stringify({
          recipients: [message.to],
          message: message.body,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new TextBeeError(`TextBee request failed: ${redactApiKey(reason, TEXTBEE_API_KEY)}`);
    }

    if (!response.ok) {
      throw new TextBeeError(
        `TextBee rejected the message (HTTP ${response.status}): ` +
          redactApiKey(await readErrorDetail(response), TEXTBEE_API_KEY),
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
      provider: "textbee",
    };
  },
};
