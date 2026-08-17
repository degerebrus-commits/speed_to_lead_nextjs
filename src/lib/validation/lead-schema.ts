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
});

export type LeadWebhookInput = z.infer<typeof leadWebhookSchema>;
