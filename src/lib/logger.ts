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

/**
 * Secret values to scrub wherever they appear, not just under a suspicious key.
 *
 * Key-name matching alone missed the common case: every route logs
 * `reason: error.message`, and "reason" is not a sensitive name, so the text of
 * an exception passed through untouched. A Prisma connection error quotes the
 * whole DATABASE_URL, credentials included.
 *
 * Read lazily and cached: the logger must not fail when configuration has not
 * loaded, which is exactly when it is most needed.
 */
let secretValues: string[] | null = null;

function knownSecrets(): string[] {
  if (secretValues !== null) return secretValues;

  const candidates = [
    process.env.DATABASE_URL,
    process.env.LEAD_WEBHOOK_SECRET,
    process.env.TEXTBEE_API_KEY,
    process.env.TEXTBEE_WEBHOOK_SECRET,
    process.env.OPENAI_API_KEY,
    process.env.ANTHROPIC_API_KEY,
    process.env.DASHBOARD_PASSWORD,
    process.env.DASHBOARD_SESSION_SECRET,
  ];

  // Short values would match far too much ordinary text.
  secretValues = candidates.filter((value): value is string => !!value && value.length >= 8);
  return secretValues;
}

/** Test-only. Configuration changes between specs. */
export function resetSecretCache(): void {
  secretValues = null;
}

function scrubValues(text: string): string {
  let scrubbed = text;
  for (const secret of knownSecrets()) {
    if (scrubbed.includes(secret)) scrubbed = scrubbed.split(secret).join("[redacted]");
  }
  return scrubbed;
}

/**
 * Recurses, because the previous version only inspected the top level: a
 * secret one object deep - `{ config: env }`, `{ err: someError }` - was
 * logged in full.
 *
 * Depth is capped rather than tracking visited objects: log context is small
 * and shallow, and a cap cannot itself throw on a cycle.
 */
function redactValue(value: unknown, depth: number): unknown {
  if (depth > 4) return "[depth-limited]";

  if (typeof value === "string") return scrubValues(value);
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));

  // Errors carry their text on non-enumerable properties, so Object.entries
  // returns nothing for them and the message would survive unscrubbed.
  if (value instanceof Error) return scrubValues(`${value.name}: ${value.message}`);

  const safe: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    safe[key] = isSensitiveKey(key) ? "[redacted]" : redactValue(nested, depth + 1);
  }
  return safe;
}

function redact(context: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    safe[key] = isSensitiveKey(key) ? "[redacted]" : redactValue(value, 1);
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
