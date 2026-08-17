import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "@/config/env";
import type { AiProvider, ChatRequest, ChatResponse } from "./ai-provider";
import { AiProviderError } from "./openai-provider";

/**
 * A customer is waiting on a text, so a slow model is a failed model.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Floor on max_tokens, regardless of what the caller asks for.
 *
 * On current Claude models thinking is on by default and max_tokens caps
 * thinking *plus* reply text together. The SMS-sized ceiling the caller passes
 * would be consumed by reasoning and truncate the answer mid-sentence, so the
 * request is given real headroom and the reply is trimmed afterwards by
 * ai-service instead.
 */
const MIN_MAX_TOKENS = 1024;

/** Used when AI_MODEL is not set. Cheap and fast, which suits SMS turns. */
const DEFAULT_MODEL = "claude-haiku-4-5";

/**
 * Short qualification turns do not need deep reasoning, and effort is the
 * lever controlling both latency and spend. Raise it if the assistant starts
 * mishandling nuanced replies.
 */
const EFFORT = "low";

/**
 * Only some models accept output_config.effort - Haiku 4.5 rejects it with a
 * 400. Sending it unconditionally would break the default model, so the
 * parameter is gated rather than assumed.
 */
function supportsEffort(model: string): boolean {
  return /^claude-(opus-5|opus-4-[678]|sonnet-5|sonnet-4-6|fable-5|mythos-5)/.test(model);
}

interface SplitMessages {
  system: string | undefined;
  turns: { role: "user" | "assistant"; content: string }[];
}

/**
 * The Messages API takes the system prompt as a top-level field rather than a
 * turn in the array, so it has to be lifted out of our provider-neutral
 * message list. Any further system messages are folded into the same field -
 * dropping them would silently discard instructions.
 */
function splitSystemPrompt(messages: ChatRequest["messages"]): SplitMessages {
  const systemParts: string[] = [];
  const turns: { role: "user" | "assistant"; content: string }[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(message.content);
    } else {
      turns.push({ role: message.role, content: message.content });
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    turns,
  };
}

export function createAnthropicProvider(): AiProvider {
  const { ANTHROPIC_API_KEY, AI_MODEL } = getEnv();
  const model = AI_MODEL ?? DEFAULT_MODEL;

  if (!ANTHROPIC_API_KEY) {
    throw new AiProviderError("ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic");
  }

  const client = new Anthropic({
    apiKey: ANTHROPIC_API_KEY,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 1,
  });

  return {
    name: "anthropic",
    model,

    async complete(request: ChatRequest): Promise<ChatResponse> {
      const { system, turns } = splitSystemPrompt(request.messages);

      if (turns.length === 0) {
        throw new AiProviderError("Anthropic requires at least one user or assistant turn");
      }

      let message: Anthropic.Message;

      try {
        message = await client.messages.create({
          model,
          max_tokens: Math.max(request.maxOutputTokens, MIN_MAX_TOKENS),
          ...(supportsEffort(model) ? { output_config: { effort: EFFORT } } : {}),
          ...(system ? { system } : {}),
          messages: turns,
        });
      } catch (error) {
        // Typed SDK errors rather than string matching, so a rate limit can be
        // told apart from a bad key without parsing prose.
        if (error instanceof Anthropic.AuthenticationError) {
          throw new AiProviderError("Anthropic rejected the API key", 401);
        }
        if (error instanceof Anthropic.RateLimitError) {
          throw new AiProviderError("Anthropic rate limit reached", 429);
        }
        if (error instanceof Anthropic.APIError) {
          throw new AiProviderError(
            `Anthropic returned HTTP ${error.status}: ${String(error.message).slice(0, 200)}`,
            error.status,
          );
        }

        const reason = error instanceof Error ? error.message : String(error);
        throw new AiProviderError(`Anthropic request failed: ${reason}`);
      }

      // Safety classifiers can decline a request with a successful HTTP 200 and
      // an empty content array. Reading content[0] first would throw on a case
      // that is not actually an error.
      if (message.stop_reason === "refusal") {
        throw new AiProviderError("Anthropic declined to answer this message");
      }

      const text = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();

      // An empty completion is a failure, not an empty reply - sending a blank
      // SMS would be worse than falling back to a holding message.
      if (text.length === 0) {
        throw new AiProviderError("Anthropic returned no text content");
      }

      return {
        text,
        model: message.model,
        provider: "anthropic",
        inputTokens: message.usage.input_tokens ?? null,
        outputTokens: message.usage.output_tokens ?? null,
      };
    },
  };
}
