type LogLevel = "info" | "warn" | "error";

/**
 * Keys that must never reach the logs, whatever context a caller passes
 * (STANDARDS.md 17, 18). Matching is case-insensitive and substring-based so
 * that `webhookSecret` and `SMS_AUTH_TOKEN` are both caught.
 */
const REDACTED_KEY_PATTERNS = [
  "secret",
  "password",
  "apikey",
  "api_key",
  "authorization",
  "credential",
  // Auth tokens specifically. A bare "token" match would also scrub
  // inputTokens/outputTokens, which are counts, not credentials - and losing
  // those blinds the cost accounting that the SMS quota guard depends on.
  "authtoken",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "bearer",
];

/** Keys that are exactly a credential, not merely containing the word. */
const REDACTED_EXACT_KEYS = ["token", "auth", "key"];

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z_]/g, "");

  if (REDACTED_EXACT_KEYS.includes(normalized)) return true;

  return REDACTED_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function redact(context: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    safe[key] = isSensitiveKey(key) ? "[redacted]" : value;
  }
  return safe;
}

function emit(level: LogLevel, message: string, context: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...redact(context),
  });

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, context?: Record<string, unknown>) => emit("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => emit("error", message, context),
};
