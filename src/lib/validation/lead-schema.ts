import { z } from "zod";

/**
 * The lead intake endpoint is public-facing, so its body is untrusted input
 * and every field is bounded (STANDARDS.md 6, 7, 29).
 *
 * Name, phone, service address and initial message are mandatory per the PRD.
 * Email is the only optional field.
 */
export const leadWebhookSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),

  phone: z.string().trim().min(7, "Phone number is too short").max(32),

  // The form may omit the key, send null, or send an empty string for an
  // untouched optional input. All three mean "no email".
  email: z
    .union([z.string().trim().email("Email is not valid").max(254), z.literal(""), z.null()])
    .optional()
    .transform((value) => (value ? value : undefined)),

  serviceAddress: z.string().trim().min(1, "Service address is required").max(300),

  message: z.string().trim().min(1, "Initial message is required").max(2000),

  /**
   * Whether the customer ticked the "you agree to be texted" box.
   *
   * Optional rather than required, deliberately: the client's form may not
   * send it yet, and rejecting the submission would lose a real customer over
   * a field their website does not populate. The lead is stored either way -
   * what consent gates is the *sending*, in sendIntroSms. Accepts a boolean or
   * the strings form tools send for a checkbox.
   */
  smsConsent: z
    .union([z.boolean(), z.enum(["true", "false", "on", "yes", "no", "1", "0"])])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (typeof value === "boolean") return value;
      return ["true", "on", "yes", "1"].includes(value);
    }),

  /**
   * The disclosure wording shown beside that box, stored verbatim. "They
   * consented" is only defensible if we can produce what they consented to,
   * and the wording changes over time.
   */
  smsConsentText: z.string().trim().max(2000).optional(),
});

export type LeadWebhookInput = z.infer<typeof leadWebhookSchema>;
