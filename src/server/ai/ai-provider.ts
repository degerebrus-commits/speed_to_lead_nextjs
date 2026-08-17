export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** Hard ceiling on the reply length. SMS should stay short. */
  maxOutputTokens: number;
  temperature: number;
}

export interface ChatResponse {
  /** The assistant's reply text. Never null - a provider that returns nothing throws. */
  text: string;
  model: string;
  provider: string;
  /** Null when the provider does not report usage. */
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * Business logic depends on this interface rather than a vendor SDK, so
 * swapping GPT for Claude is a configuration change (STANDARDS.md 32).
 *
 * The interface is deliberately narrow: one call, plain text in and out. The
 * AI proposes wording; it never executes anything. Tools, booking and status
 * changes stay in application code where they can be validated (STANDARDS.md
 * 2.3, 22).
 */
export interface AiProvider {
  readonly name: string;
  readonly model: string;
  complete(request: ChatRequest): Promise<ChatResponse>;
}
