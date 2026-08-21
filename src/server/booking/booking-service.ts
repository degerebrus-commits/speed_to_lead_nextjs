import { Prisma, type Appointment, type Lead } from "@prisma/client";
import { getBookingSettings, getBusinessProfile, getMessageTemplates } from "@/config/business";
import { prisma } from "@/lib/db";
import {
  SLOT_HORIZON_DAYS,
  buildScheduledSlotKey,
  formatSlotForCustomer,
  resolveOccurrences,
} from "./slot-schedule";
import { logger } from "@/lib/logger";
import {
  createCalendarEvent,
  getBusyIntervals,
  overlapsBusy,
} from "@/server/calendar/calendar-service";
import { renderTemplate } from "@/server/sms/sms-templates";

/**
 * Booking runs in application code, not through the model.
 *
 * STANDARDS.md 57.5 - never tell a customer an appointment is booked until it
 * actually is - is a guarantee that cannot depend on a model parsing a reply
 * correctly. So the customer is offered numbered slots and answers with a
 * number, and every step from there is deterministic.
 *
 * The AI still runs the conversation around this; it just does not decide
 * whether a booking happened.
 */

/** Words that mean "I want to book", checked on the first word or as a phrase. */
const BOOKING_INTENT_PHRASES = [
  "book",
  "booking",
  "schedule",
  "appointment",
  "come out",
  "send someone",
  "when can you",
];

/**
 * Slot identity for the unique constraint. Fixed-slot mode has no real
 * timestamps, so the label itself is the resource being contended for.
 */
function buildSlotKey(slotLabel: string): string {
  return slotLabel.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Whether a customer message is asking to book. */
export function hasBookingIntent(messageBody: string): boolean {
  const haystack = normalize(messageBody);
  if (haystack.length === 0) return false;

  return BOOKING_INTENT_PHRASES.some((phrase) => haystack.includes(phrase));
}

/**
 * Which offered slot a reply selects, or null.
 *
 * Accepts the number ("2"), the number in a sentence ("2 please"), or the
 * label itself ("Mon-Fri 11am") - customers do all three. Returns null rather
 * than guessing when the reply is ambiguous, because a wrong guess books the
 * wrong time.
 *
 * `allowNumericChoice` must be false unless this customer was just shown a
 * numbered list. A bare digit is only a choice in reply to one: read
 * unconditionally it turns "it's been broken for 3 days" into a confirmed
 * appointment. A label match carries its own context and is always safe -
 * nobody types "Mon-Fri 11am" by accident.
 */
export function matchSlotChoice(
  messageBody: string,
  offeredSlots: SlotCandidate[],
  allowNumericChoice: boolean,
): SlotCandidate | null {
  const haystack = normalize(messageBody);
  if (haystack.length === 0 || offeredSlots.length === 0) return null;

  // A rejection can contain a digit - "none of those 3 work". Checked first so
  // it is never read as picking one.
  if (wantsDifferentSlots(messageBody)) return null;

  if (allowNumericChoice) {
    const numeric = haystack.match(/\b([1-9]\d?)\b/);
    if (numeric) {
      const index = Number.parseInt(numeric[1], 10) - 1;
      if (index >= 0 && index < offeredSlots.length) return offeredSlots[index];
    }
  }

  // Both the way it was written to them and the underlying window. A customer
  // who types "Mon Aug 25, 9am" back is matched by the first; one who types
  // "Mon 9am" by neither, and gets asked again rather than booked wrongly.
  // The dated wording first. It names one specific visit, so a hit here is
  // never ambiguous.
  const byDisplay = offeredSlots.filter((slot) => haystack.includes(normalize(slot.display)));
  if (byDisplay.length === 1) return byDisplay[0];
  if (byDisplay.length > 1) return null;

  const byLabel = offeredSlots.filter((slot) => haystack.includes(normalize(slot.label)));
  if (byLabel.length === 0) return null;

  // A window recurs, so "Sat 10am" legitimately matches every Saturday in the
  // horizon. That is not ambiguity about *what* they want, only about which
  // occurrence - and they mean the next one. Requiring a single match here
  // rejected the reply outright and sent the customer to the model instead.
  const labels = new Set(byLabel.map((slot) => slot.label));
  if (labels.size > 1) return null;

  return byLabel.reduce((soonest, slot) => (slot.at < soonest.at ? slot : soonest));
}

/**
 * Phrases meaning "none of those, show me others".
 *
 * Deliberately requires an explicit rejection rather than treating any
 * non-choice as one. A message we cannot parse goes to the model to answer;
 * only a clear "these do not work" burns the current set and spends three more
 * slots - and a customer who has to say it twice has been failed already.
 *
 * Bare "no" is included only when it is the whole message. Inside a sentence it
 * means too many other things ("no heat since Friday") to spend an offer on.
 */
const REJECTION_PHRASES = [
  "none of these",
  "none of those",
  "none work",
  "none of them",
  "doesn t work",
  "does not work",
  "dont work",
  "do not work",
  "can t do",
  "cannot do",
  "can t make",
  "no good",
  "another time",
  "other times",
  "other options",
  "different time",
  "something else",
  "anything else",
  "later date",
  "next week",
];

export function wantsDifferentSlots(messageBody: string): boolean {
  const haystack = normalize(messageBody);
  if (haystack.length === 0) return false;

  if (haystack === "no" || haystack === "nope" || haystack === "none") return true;

  return REJECTION_PHRASES.some((phrase) => haystack.includes(phrase));
}

/** One bookable occurrence: a configured window resolved to a real date. */
export interface SlotCandidate {
  /** The configured label, e.g. "Mon-Fri 9am". Stored on the appointment. */
  label: string;
  /** When the visit starts. */
  at: Date;
  /** Identity for the unique constraint and for tracking what was declined. */
  key: string;
  /** How it is written to the customer, e.g. "Mon Aug 25, 9am". */
  display: string;
}

/**
 * Every open occurrence within the horizon, soonest first.
 *
 * "Open" means three things at once, and all three have to hold: nobody else
 * has booked it here, the business is not already busy then according to their
 * own calendar, and this customer has not already turned it down.
 *
 * Sorted chronologically rather than in configured order. The configured list
 * describes recurring windows, so its order says nothing about which comes
 * first in real time - on a Friday, "Sat 10am" is sooner than "Mon-Fri 9am".
 * Offering the soonest is also the whole point of the product.
 */
export async function getOpenSlotCandidates(
  now: Date = new Date(),
  excludeKeys: readonly string[] = [],
): Promise<SlotCandidate[]> {
  const { fixedSlots, durationMinutes } = getBookingSettings();
  if (fixedSlots.length === 0) return [];

  const { timezone } = getBusinessProfile();

  // Expand each configured window into its occurrences over the horizon.
  const candidates: SlotCandidate[] = [];
  const seen = new Set<string>();

  for (const label of fixedSlots) {
    for (const at of resolveOccurrences(label, now, SLOT_HORIZON_DAYS, timezone)) {
      const key = buildScheduledSlotKey(label, at);
      // Two configured windows can resolve to the same instant - "Mon-Fri 9am"
      // and "Mon 9am" both cover Monday. Offering it twice would number the
      // same visit 1 and 2.
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ label, at, key, display: formatSlotForCustomer(at, timezone) });
    }
  }

  candidates.sort((a, b) => a.at.getTime() - b.at.getTime());

  // Only appointments still ahead of us can block a slot. Querying every
  // appointment ever made was what exhausted the schedule permanently: with
  // the key derived from the label alone, six configured slots meant six
  // bookings in the lifetime of the deployment.
  const taken = await prisma.appointment.findMany({
    where: {
      status: { in: ["PENDING", "CONFIRMED"] },
      OR: [{ scheduledAt: { gte: now } }, { scheduledAt: null }],
    },
    select: { slotKey: true },
  });

  const blocked = new Set([...taken.map((a) => a.slotKey), ...excludeKeys]);
  const stillOpen = candidates.filter((c) => !blocked.has(c.key));

  if (stillOpen.length === 0) return [];

  // One calendar read for the whole window, not one per slot.
  const busy = await getBusyIntervals(
    stillOpen[0].at,
    new Date(stillOpen[stillOpen.length - 1].at.getTime() + durationMinutes * 60 * 1000),
  );

  if (busy.length === 0) return stillOpen;

  return stillOpen.filter(
    (c) => !overlapsBusy(c.at, new Date(c.at.getTime() + durationMinutes * 60 * 1000), busy),
  );
}

/**
 * Rebuilds the candidates behind a stored list of slot keys, in stored order.
 *
 * Availability is deliberately not consulted: this answers "what was this
 * customer shown", which stays true even after one of those slots is taken by
 * somebody else. Filtering here would silently renumber the list the customer
 * is looking at, which is the exact failure persisting the keys prevents.
 */
export function resolveCandidatesByKeys(
  keys: readonly string[],
  now: Date = new Date(),
): SlotCandidate[] {
  if (keys.length === 0) return [];

  const { fixedSlots } = getBookingSettings();
  const { timezone } = getBusinessProfile();

  const byKey = new Map<string, SlotCandidate>();

  for (const label of fixedSlots) {
    for (const at of resolveOccurrences(label, now, SLOT_HORIZON_DAYS, timezone)) {
      const key = buildScheduledSlotKey(label, at);
      if (!byKey.has(key)) {
        byKey.set(key, { label, at, key, display: formatSlotForCustomer(at, timezone) });
      }
    }
  }

  // Keys that no longer resolve are dropped rather than faked. A configured
  // window removed since the offer, or an occurrence now in the past, has no
  // honest candidate to return.
  return keys.map((key) => byKey.get(key)).filter((c): c is SlotCandidate => c !== undefined);
}

/**
 * The next set to put in front of the customer.
 *
 * Capped at SLOT_OFFER_COUNT - three by default. Showing everything free for
 * three weeks is not a choice, it is a wall of text; the customer who cannot
 * use any of these asks for more and gets the next set.
 */
export async function getAvailableSlots(
  now: Date = new Date(),
  excludeKeys: readonly string[] = [],
): Promise<SlotCandidate[]> {
  const { offerCount } = getBookingSettings();
  const open = await getOpenSlotCandidates(now, excludeKeys);
  return open.slice(0, offerCount);
}

/**
 * The message offering slots, numbered so a reply of "2" is unambiguous.
 *
 * `again` changes the opening line only. A customer who has just turned down
 * three times needs to hear that these are different ones, not a repeat of a
 * message they already answered.
 */
export function buildSlotOffer(slots: SlotCandidate[], again = false): string {
  const numbered = slots.map((slot, index) => `${index + 1}) ${slot.display}`).join(", ");

  const opener = again
    ? "No problem - here are the next few"
    : "I can get someone out to you. Which works best";

  return `${opener} - ${numbered}? Just reply with the number.`;
}

export type BookingFailure = "no-slots" | "slot-taken" | "not-configured";

export interface BookingResult {
  appointment: Appointment | null;
  failure: BookingFailure | null;
  /** The confirmation to send, when booking succeeded. */
  confirmation: string | null;
}

/**
 * Books a slot for a lead.
 *
 * Double-booking is prevented by the unique constraint on `slotKey`, not by
 * checking availability first: two customers replying at the same moment would
 * both pass a read-then-write check, and both would be told they had the slot.
 * One of them has to lose at the database instead.
 */
export async function bookSlot(lead: Lead, choice: SlotCandidate): Promise<BookingResult> {
  const { fixedSlots, durationMinutes } = getBookingSettings();

  if (fixedSlots.length === 0) {
    return { appointment: null, failure: "not-configured", confirmation: null };
  }

  if (!fixedSlots.some((slot) => buildSlotKey(slot) === buildSlotKey(choice.label))) {
    return { appointment: null, failure: "no-slots", confirmation: null };
  }

  // The instant comes from the candidate that was actually offered, never from
  // re-resolving the label. Re-resolving returns the *next* occurrence, so a
  // customer offered a slot two weeks out - because they turned down
  // everything sooner - would have been booked into this week instead, and
  // told a date nobody agreed to.
  const scheduledAt = choice.at;
  const scheduledEndAt = new Date(scheduledAt.getTime() + durationMinutes * 60 * 1000);

  try {
    const appointment = await prisma.appointment.create({
      data: {
        leadId: lead.id,
        slotLabel: choice.label,
        slotKey: choice.key,
        scheduledAt,
        scheduledEndAt,
        durationMinutes,
      },
    });

    await prisma.lead.update({ where: { id: lead.id }, data: { status: "BOOKED" } });

    // Written to the calendar after the booking is committed, and never in a
    // way that can undo it. createCalendarEvent does not throw: if Google is
    // down or misconfigured the appointment still stands, the customer is
    // still told, and calendarEventId stays null for a backfill.
    const calendar = await createCalendarEvent(lead, appointment);

    if (calendar.eventId) {
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { calendarEventId: calendar.eventId },
      });
      appointment.calendarEventId = calendar.eventId;
    }

    const business = getBusinessProfile();
    const confirmation = renderTemplate(getMessageTemplates().bookingConfirmation, {
      firstName: "",
      businessName: business.name,
      repName: business.repName,
      // The dated form, not the recurring window. "Mon-Fri 9am" as a
      // confirmation tells the customer nothing about which day to be in.
      time: choice.display,
    });

    logger.info("Appointment booked", { leadId: lead.id, appointmentId: appointment.id });

    return { appointment, failure: null, confirmation };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Someone else took it between the offer and the reply.
      logger.info("Slot already taken", { leadId: lead.id });
      return { appointment: null, failure: "slot-taken", confirmation: null };
    }

    throw error;
  }
}
