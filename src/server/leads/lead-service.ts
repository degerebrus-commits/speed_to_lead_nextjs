import { createHash } from "node:crypto";
import { Prisma, type Lead } from "@prisma/client";
import { getBusinessProfile } from "@/config/business";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import type { LeadWebhookInput } from "@/lib/validation/lead-schema";

/**
 * Identity of a submission: the same person sending the same message is the
 * same lead. Derived from the normalised phone so formatting differences in
 * the website form cannot produce two keys for one submission.
 */
export function buildDedupeKey(normalizedPhone: string, message: string): string {
  return createHash("sha256").update(`${normalizedPhone}:${message.trim()}`).digest("hex");
}

export interface CreateLeadResult {
  lead: Lead;
  /** False when this submission collided with one already stored. */
  isNew: boolean;
}

/**
 * Stores a lead idempotently.
 *
 * The duplicate check is the unique constraint on dedupeKey, not a preceding
 * SELECT. A SELECT takes no lock, so two simultaneous deliveries of the same
 * webhook would both read nothing, both pass the check, and both insert -
 * creating a second lead and texting the customer twice.
 */
export async function createLead(input: LeadWebhookInput): Promise<CreateLeadResult> {
  const { countryCode } = getBusinessProfile();
  const phone = normalizePhone(input.phone, countryCode);
  const dedupeKey = buildDedupeKey(phone, input.message);

  try {
    const lead = await prisma.lead.create({
      data: {
        name: input.name,
        phone,
        email: input.email ?? null,
        serviceAddress: input.serviceAddress,
        initialMessage: input.message,
        dedupeKey,
        // Stamped server-side at the moment of submission rather than taken
        // from the payload: a consent timestamp the caller could choose is
        // not evidence of anything.
        smsConsentAt: input.smsConsent === true ? new Date() : null,
        smsConsentText: input.smsConsent === true ? (input.smsConsentText ?? null) : null,
        smsConsentSource: input.smsConsent === true ? "website-form" : null,
      },
    });

    return { lead, isNew: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.lead.findUnique({ where: { dedupeKey } });

      // The row must exist - we just lost a race to it. If it somehow does
      // not, the unique violation came from elsewhere and must not be hidden.
      if (existing) return { lead: existing, isNew: false };
    }

    throw error;
  }
}
