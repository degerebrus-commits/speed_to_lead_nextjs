import { getEnv } from "@/config/env";

/**
 * The per-client customization seam.
 *
 * This system is deployed once per service business rather than sold as a
 * multi-tenant SaaS, so standing it up for a new client means supplying new
 * values here - not adding a tenant row. Nothing customer-facing is hardcoded
 * anywhere else in the codebase.
 *
 * Adapting the product to another vertical (plumbing, electrical, roofing)
 * needs no code change either - only different configuration.
 */
export interface BusinessProfile {
  /** Rendered into customer-facing SMS copy. */
  name: string;
  /** Name the assistant signs messages with. */
  repName: string;
  /** E.164 calling code applied to phone numbers submitted without one. */
  countryCode: string;
  timezone: string;
  /** Human-readable opening hours, quoted to customers verbatim. */
  hours: string;
  /** Where the business will travel. Empty means "not configured". */
  serviceArea: string;
  /** Alerted when a conversation is escalated. Null when not configured. */
  ownerPhone: string | null;
  /** The trade, as the assistant describes it. */
  vertical: string;
  /** What the visiting engineer is called. */
  technicianNoun: string;
  /** Problem categories to qualify against. Empty when not configured. */
  serviceTypes: string[];
  /** Hazards that must stop qualification. Empty when not configured. */
  safetyHazards: string[];
}

function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export interface MessageTemplates {
  intro: string;
  afterHours: string;
  emergency: string;
  bookingConfirmation: string;
  help: string;
  ownerAlert: string;
  cancellation: string;
  nothingToCancel: string;
}

export interface BookingSettings {
  mode: "fixed" | "calendar";
  durationMinutes: number;
  /** Parsed from the comma-separated list; empty when none configured. */
  fixedSlots: string[];
}

export function getBusinessProfile(): BusinessProfile {
  const env = getEnv();

  return {
    name: env.BUSINESS_NAME,
    repName: env.REP_NAME,
    countryCode: env.BUSINESS_COUNTRY_CODE,
    timezone: env.BUSINESS_TIMEZONE,
    hours: env.BUSINESS_HOURS,
    serviceArea: env.SERVICE_AREA.trim(),
    ownerPhone: env.OWNER_PHONE ?? null,
    vertical: env.BUSINESS_VERTICAL,
    technicianNoun: env.TECHNICIAN_NOUN,
    serviceTypes: splitList(env.SERVICE_TYPES),
    safetyHazards: splitList(env.SAFETY_HAZARDS),
  };
}

export function getMessageTemplates(): MessageTemplates {
  const env = getEnv();

  return {
    intro: env.SMS_INTRO_TEMPLATE,
    afterHours: env.SMS_AFTER_HOURS_TEMPLATE,
    emergency: env.SMS_EMERGENCY_TEMPLATE,
    bookingConfirmation: env.SMS_BOOKING_CONFIRMATION_TEMPLATE,
    help: env.SMS_HELP_TEMPLATE,
    ownerAlert: env.SMS_OWNER_ALERT_TEMPLATE,
    cancellation: env.SMS_CANCELLATION_TEMPLATE,
    nothingToCancel: env.SMS_NOTHING_TO_CANCEL_TEMPLATE,
  };
}

export function getBookingSettings(): BookingSettings {
  const env = getEnv();

  return {
    mode: env.BOOKING_MODE,
    durationMinutes: env.APPOINTMENT_DURATION_MINUTES,
    fixedSlots: env.AVAILABLE_TIME_SLOTS.split(",")
      .map((slot) => slot.trim())
      .filter((slot) => slot.length > 0),
  };
}

export function isAfterHoursReplyEnabled(): boolean {
  return getEnv().AFTER_HOURS_REPLY_ENABLED === "true";
}

/** Configured emergency keywords, lower-cased and de-duplicated. */
export function getEmergencyKeywords(): string[] {
  const raw = getEnv().EMERGENCY_KEYWORDS;

  return Array.from(
    new Set(
      raw
        .split(",")
        .map((keyword) => keyword.trim().toLowerCase())
        .filter((keyword) => keyword.length > 0),
    ),
  );
}
