import type { Message } from "@prisma/client";
import { getBusinessProfile } from "@/config/business";
import { getEnv } from "@/config/env";
import { logger } from "@/lib/logger";
import type { AiProvider, ChatMessage } from "./ai-provider";
import { createAnthropicProvider } from "./anthropic-provider";
import { AiProviderError, createOpenAiProvider } from "./openai-provider";
import { buildSystemPrompt, type KnownLeadFacts } from "./system-prompt";

let providerOverride: AiProvider | null = null;

/** Test-only. Lets a spec substitute a stub and assert what was sent. */
export function setAiProviderForTesting(provider: AiProvider | null): void {
  providerOverride = provider;
}

function getAiProvider(): AiProvider {
  if (providerOverride) return providerOverride;

  // Belt and braces against a test run spending real tokens. Specs install a
  // stub in tests/setup.ts, but a stray import path would otherwise reach the
  // live API with the key that sits in .env.
  if (process.env.NODE_ENV === "test") {
    throw new AiProviderError("Refusing to use a real AI provider during tests");
  }

  const { AI_PROVIDER } = getEnv();

  return AI_PROVIDER === "anthropic" ? createAnthropicProvider() : createOpenAiProvider();
}

/**
 * Converts stored messages into the provider's chat format.
 *
 * Direction is the mapping: what we sent is the assistant's turn, what the
 * customer sent is the user's.
 */
function toChatHistory(messages: Message[]): ChatMessage[] {
  return messages.map((message) => ({
    role: message.direction === "OUTBOUND" ? ("assistant" as const) : ("user" as const),
    content: message.body,
  }));
}

/**
 * Trims a reply to one or two SMS segments without cutting mid-sentence where
 * possible. A model told to be brief usually is; this is the backstop for when
 * it is not.
 */
function trimToSmsLength(text: string, maxLength: number = getEnv().SMS_MAX_LENGTH): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;

  const truncated = collapsed.slice(0, maxLength);
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf(". "),
    truncated.lastIndexOf("? "),
    truncated.lastIndexOf("! "),
  );

  // Only prefer a sentence boundary if it keeps most of the reply.
  if (lastSentenceEnd > maxLength * 0.6) {
    return truncated.slice(0, lastSentenceEnd + 1).trim();
  }

  return `${truncated.slice(0, maxLength - 1).trimEnd()}…`;
}

export interface QualificationResult {
  reply: string;
  provider: string;
  model: string;
}

/**
 * Produces the next reply in a qualification conversation.
 *
 * Throws rather than returning a placeholder when the provider fails - the
 * caller decides whether to send a holding message or escalate, because only
 * it knows whether a human is available.
 */
export async function generateQualificationReply(
  history: Message[],
  lead?: KnownLeadFacts,
): Promise<QualificationResult> {
  const business = getBusinessProfile();
  const provider = getAiProvider();
  const env = getEnv();

  const recent = history.slice(-env.AI_HISTORY_LIMIT);

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(business, lead) },
    ...toChatHistory(recent),
  ];

  const response = await provider.complete({
    messages,
    maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
    temperature: env.AI_TEMPERATURE,
  });

  const reply = trimToSmsLength(response.text, env.SMS_MAX_LENGTH);

  logger.info("AI reply generated", {
    provider: response.provider,
    model: response.model,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    replyLength: reply.length,
    historyTurns: recent.length,
  });

  return { reply, provider: response.provider, model: response.model };
}
