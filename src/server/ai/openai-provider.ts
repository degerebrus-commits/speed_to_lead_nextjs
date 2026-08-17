import { getEnv } from "@/config/env";
import type { AiProvider, ChatRequest, ChatResponse } from "./ai-provider";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

/** Used when AI_MODEL is not set. */
const DEFAULT_MODEL = "gpt-4o-mini";

/**
 * A customer is waiting on a text, so a slow model is a failed model. Beyond
 * this the conversation falls back to a safe holding reply.
 */
const REQUEST_TIMEOUT_MS = 20_000;

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

/** Strips the API key from any text headed for a log or an error message. */
function redactApiKey(text: string, apiKey: string): string {
  return apiKey.length > 0 ? text.split(apiKey).join("[redacted]") : text;
}

export function createOpenAiProvider(): AiProvider {
  const { OPENAI_API_KEY, AI_MODEL } = getEnv();
  const model = AI_MODEL ?? DEFAULT_MODEL;

  if (!OPENAI_API_KEY) {
    throw new AiProviderError("OPENAI_API_KEY is required when AI_PROVIDER=openai");
  }

  return {
    name: "openai",
    model,

    async complete(request: ChatRequest): Promise<ChatResponse> {
      let response: Response;

      try {
        response = await fetch(OPENAI_CHAT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model,
            messages: request.messages,
            max_tokens: request.maxOutputTokens,
            temperature: request.temperature,
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new AiProviderError(
          `OpenAI request failed: ${redactApiKey(reason, OPENAI_API_KEY)}`,
        );
      }

      if (!response.ok) {
        let detail = "";
        try {
          detail = (await response.text()).slice(0, 300);
        } catch {
          detail = "<unreadable response body>";
        }

        throw new AiProviderError(
          `OpenAI returned HTTP ${response.status}: ${redactApiKey(detail, OPENAI_API_KEY)}`,
          response.status,
        );
      }

      let payload: {
        choices?: { message?: { content?: string }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      try {
        payload = await response.json();
      } catch {
        throw new AiProviderError("OpenAI returned a body that is not JSON");
      }

      const text = payload.choices?.[0]?.message?.content?.trim();

      // An empty completion is a failure, not an empty reply. Sending a blank
      // SMS to a customer would be worse than falling back to a holding
      // message, so the caller must be told.
      if (!text) {
        throw new AiProviderError("OpenAI returned no message content");
      }

      return {
        text,
        model,
        provider: "openai",
        inputTokens: payload.usage?.prompt_tokens ?? null,
        outputTokens: payload.usage?.completion_tokens ?? null,
      };
    },
  };
}
