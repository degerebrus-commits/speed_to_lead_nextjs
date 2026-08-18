import { z } from "zod";

/**
 * Default introductory SMS copy, worded as specified in the PRD user journey.
 *
 * It lives here as a default rather than as a literal in the SMS layer so a
 * deployment can reword it without a code change. Placeholders are documented
 * in src/server/sms/sms-templates.ts.
 */
export const DEFAULT_SMS_INTRO_TEMPLATE =
  "Hi {firstName}! Thanks for contacting {businessName}. I'm here to help. Can you tell me a little about the issue you're experiencing?";

/**
 * Environment is validated once, at first access, and the process fails loudly
 * if anything is missing. A misconfigured deployment should refuse to start
 * rather than accept leads it cannot store or text.
 */
const baseSchema = z.object({
  DATABASE_URL: z.string().url(),

  LEAD_WEBHOOK_SECRET: z
    .string()
    .min(16, "must be at least 16 characters - generate with: openssl rand -hex 24"),

  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  /**
   * Password for the dashboard. One shared password rather than user accounts:
   * this deployment serves one business, and the dashboard shows every
   * customer's name, phone, home address and full message history, so it needs
   * a door - but not a user table, roles, or a password reset flow.
   *
   * Optional in the schema so a fresh checkout runs. Unset means the dashboard
   * refuses to serve at all rather than serving openly: failing closed is the
   * only safe default for a screen holding this data.
   */
  DASHBOARD_PASSWORD: z
    .string()
    .min(12, "must be at least 12 characters - generate with: openssl rand -hex 16")
    .optional(),

  /**
   * Signing key for the session cookie. Defaults to the dashboard password so
   * a deployment needs one secret rather than two; set it separately to rotate
   * sessions without changing the password people type.
   */
  DASHBOARD_SESSION_SECRET: z.string().min(16).optional(),

  /** How long a dashboard login lasts. */
  DASHBOARD_SESSION_HOURS: z.coerce.number().int().positive().default(12),

  // --- Per-client values. Everything below differs between deployments. ---
  BUSINESS_NAME: z.string().min(1),
  BUSINESS_COUNTRY_CODE: z
    .string()
    .regex(/^\+\d{1,3}$/, "must be a country calling code such as +1"),

  SMS_INTRO_TEMPLATE: z.string().min(1).default(DEFAULT_SMS_INTRO_TEMPLATE),

  SMS_PROVIDER: z.enum(["console", "textbee", "twilio"]).default("console"),

  /**
   * Hard ceiling on real texts sent per calendar month. Exists because the
   * TextBee free tier allows 50 and a retry loop could exhaust that in
   * seconds. Not billing-accurate - a safety valve, not an invariant.
   */
  SMS_MONTHLY_LIMIT: z.coerce.number().int().positive().default(50),

  // Required only when SMS_PROVIDER=textbee - see the refinement below.
  TEXTBEE_API_KEY: z.string().min(1).optional(),
  TEXTBEE_DEVICE_ID: z.string().min(1).optional(),

  // --- Client identity, continued -----------------------------------------
  /** Name the AI signs messages with. */
  REP_NAME: z.string().min(1).default("the team"),
  BUSINESS_TIMEZONE: z.string().min(1).default("UTC"),
  /** Human-readable opening hours, quoted to customers verbatim. */
  BUSINESS_HOURS: z.string().min(1).default("Monday to Friday, 9am to 5pm"),
  /**
   * Structured equivalent, used to decide whether we are open right now.
   * The human string above is prose and cannot be parsed reliably, so the two
   * are kept separate - tests/config asserts nothing, so keep them consistent
   * by hand when either changes.
   */
  BUSINESS_OPEN_HOUR: z.coerce.number().int().min(0).max(23).default(8),
  BUSINESS_CLOSE_HOUR: z.coerce.number().int().min(1).max(24).default(18),
  /** ISO weekday numbers the business operates, 1=Monday .. 7=Sunday. */
  BUSINESS_OPEN_DAYS: z.string().default("1,2,3,4,5,6"),
  /** Where the business will travel. The AI must never invent this. */
  SERVICE_AREA: z.string().min(1).default(""),
  /** Alerted when a conversation is escalated. */
  OWNER_PHONE: z.string().regex(/^\+[1-9]\d{7,14}$/, "must be E.164").optional(),

  // --- Message copy --------------------------------------------------------
  SMS_AFTER_HOURS_TEMPLATE: z.string().min(1).default(
    "Hi, this is {repName} from {businessName}. We received your request and will follow up first thing in the morning. If this is an emergency, reply EMERGENCY and we will call you right away.",
  ),
  SMS_EMERGENCY_TEMPLATE: z.string().min(1).default(
    "Thanks for letting us know - treating this as urgent. {repName} from {businessName} will call you right away.",
  ),
  SMS_BOOKING_CONFIRMATION_TEMPLATE: z.string().min(1).default(
    "You're all set! Your appointment with {businessName} is confirmed for {time}. Reply STOP to opt out.",
  ),
  /**
   * Reply to HELP. Required by CTIA guidelines and by the consent disclosure
   * the customer agreed to on the form ("Reply HELP for help"), so it must
   * identify the business and repeat how to opt out. Answered from code, never
   * by the model - a compliance reply is not a judgement call.
   */
  SMS_HELP_TEMPLATE: z.string().min(1).default(
    "{businessName}: this is an automated assistant for booking service visits. Call {ownerPhone} to reach a person. Reply STOP to opt out. Msg & data rates may apply.",
  ),
  AFTER_HOURS_REPLY_ENABLED: z.enum(["true", "false"]).default("true"),

  // --- Booking (Phase 5) ---------------------------------------------------
  BOOKING_MODE: z.enum(["fixed", "calendar"]).default("fixed"),
  APPOINTMENT_DURATION_MINUTES: z.coerce.number().int().positive().default(90),
  AVAILABLE_TIME_SLOTS: z.string().default(""),

  // --- Trade / vertical ----------------------------------------------------
  /** The trade, as the assistant should describe it: HVAC, plumbing, roofing. */
  BUSINESS_VERTICAL: z.string().min(1).default("home services"),
  /** What the person who visits is called: technician, plumber, electrician. */
  TECHNICIAN_NOUN: z.string().min(1).default("technician"),
  /**
   * Comma-separated problem categories the assistant should try to identify.
   * These are what makes the qualification questions specific to the trade.
   */
  SERVICE_TYPES: z.string().default(""),
  /**
   * Comma-separated hazards that must stop qualification and escalate.
   * Distinct from EMERGENCY_KEYWORDS: those are matched in code against the
   * customer's words, these are described to the model in the prompt.
   */
  SAFETY_HAZARDS: z.string().default(""),

  // --- Conversation tuning -------------------------------------------------
  /** Hard cap on an outgoing SMS body. Two segments by default. */
  SMS_MAX_LENGTH: z.coerce.number().int().positive().default(320),
  /** How many past turns to send the model. Bounded for cost. */
  AI_HISTORY_LIMIT: z.coerce.number().int().positive().default(20),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(160),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.4),
  /** Inbound deliveries older than this are treated as replays. */
  WEBHOOK_MAX_AGE_MINUTES: z.coerce.number().int().positive().default(5),
  /** Requests per window allowed on the inbound SMS webhook. */
  SMS_WEBHOOK_RATE_LIMIT: z.coerce.number().int().positive().default(120),

  // --- Safety --------------------------------------------------------------
  /**
   * Comma-separated. Matched in application code rather than left to the model:
   * STANDARDS.md 21 requires critical business rules to live in code, and an
   * emergency must be caught even when the AI provider is unreachable.
   */
  EMERGENCY_KEYWORDS: z.string().default(""),

  // --- AI ------------------------------------------------------------------
  AI_PROVIDER: z.enum(["openai", "anthropic"]).default("openai"),
  /**
   * Optional override. Left blank, each provider uses its own default, so
   * switching AI_PROVIDER is genuinely a one-variable change - a single shared
   * model name would otherwise send an OpenAI model id to Anthropic.
   */
  AI_MODEL: z
    .string()
    .optional()
    // A blank value in .env must mean "unset", not a model literally named "".
    .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined)),
  OPENAI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  /**
   * Signs inbound webhook deliveries. Set the same value in the TextBee
   * dashboard when creating the webhook - 20 characters minimum, per their
   * guidance.
   */
  TEXTBEE_WEBHOOK_SECRET: z.string().min(20).optional(),
});

/**
 * Provider credentials are conditionally required. Declaring them optional and
 * checking here means a console-only deployment is not forced to invent TextBee
 * values, while a textbee deployment cannot start half-configured and discover
 * it at the moment a real customer is waiting for a text.
 */
const envSchema = baseSchema.superRefine((env, ctx) => {
  if (env.SMS_PROVIDER === "textbee") {
    for (const key of ["TEXTBEE_API_KEY", "TEXTBEE_DEVICE_ID", "TEXTBEE_WEBHOOK_SECRET"] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: "is required when SMS_PROVIDER=textbee",
        });
      }
    }
  }

  // The AI credential is required for whichever provider is selected, so a
  // deployment cannot start believing it can hold a conversation it cannot.
  const requiredAiKey = env.AI_PROVIDER === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  if (!env[requiredAiKey]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [requiredAiKey],
      message: `is required when AI_PROVIDER=${env.AI_PROVIDER}`,
    });
  }
});

export type Env = z.infer<typeof baseSchema>;

/**
 * The single source of truth for which keys the application requires.
 * tests/config/env-example.test.ts asserts .env.example carries exactly these,
 * because a key present in one file and absent from the other breaks a new
 * deployment at startup and nothing else would catch it.
 */
export const ENV_KEYS: readonly string[] = Object.keys(baseSchema.shape).sort();

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // Report key names and reasons only. Values are never included - one of
    // them is the database password (STANDARDS.md 18).
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".")} (${issue.message})`)
      .join(", ");
    throw new Error(`Invalid environment configuration: ${problems}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

/** Test-only. Lets a spec change env vars and have them re-read. */
export function resetEnvCache(): void {
  cachedEnv = null;
}
