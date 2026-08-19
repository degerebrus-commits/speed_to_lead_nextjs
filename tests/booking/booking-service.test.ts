import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/config/env";
import { prisma } from "@/lib/db";
import {
  type SlotCandidate,
  bookSlot,
  buildSlotOffer,
  getAvailableSlots,
  hasBookingIntent,
  matchSlotChoice,
  wantsDifferentSlots,
} from "@/server/booking/booking-service";
import {
  buildScheduledSlotKey,
  formatSlotForCustomer,
  resolveNextOccurrence,
} from "@/server/booking/slot-schedule";

const SLOTS = ["Mon-Fri 9am", "Mon-Fri 11am", "Mon-Fri 2pm", "Sat 10am"];

/**
 * A configured label as the offer code would produce it.
 *
 * Built through the real resolver rather than with a hand-written date, so a
 * change to how occurrences are resolved shows up here rather than being
 * papered over by a fixture that agrees with nothing.
 */
function candidate(label: string, now: Date = new Date()): SlotCandidate {
  const at = resolveNextOccurrence(label, now);
  if (at === null) throw new Error(`Test fixture: "${label}" does not resolve to a date`);

  return { label, at, key: buildScheduledSlotKey(label, at), display: formatSlotForCustomer(at) };
}

const OFFERED = SLOTS.map((label) => candidate(label));

let seq = 0;

async function seedLead() {
  seq += 1;
  return prisma.lead.create({
    data: {
      name: `Lead ${seq}`,
      phone: `+1555111${String(seq).padStart(4, "0")}`,
      serviceAddress: "1 Test Street",
      initialMessage: "test",
      dedupeKey: `booking-${seq}-${Date.now()}-${Math.random()}`,
    },
  });
}

beforeEach(() => {
  process.env.BOOKING_MODE = "fixed";
  process.env.AVAILABLE_TIME_SLOTS = SLOTS.join(",");
  process.env.APPOINTMENT_DURATION_MINUTES = "90";
  resetEnvCache();
});

describe("hasBookingIntent", () => {
  it("recognises the ways customers actually ask", () => {
    for (const message of [
      "Can I book someone in?",
      "I'd like to schedule a visit",
      "when can you come out?",
      "Please send someone",
      "need an appointment",
    ]) {
      expect(hasBookingIntent(message), message).toBe(true);
    }
  });

  it("does not fire on ordinary conversation", () => {
    for (const message of ["It stopped cooling last night", "It's a house", "Yes that's right"]) {
      expect(hasBookingIntent(message), message).toBe(false);
    }
  });
});

describe("matchSlotChoice", () => {
  it("accepts a bare number once slots have been offered", () => {
    expect(matchSlotChoice("2", OFFERED, true)?.label).toBe("Mon-Fri 11am");
  });

  it("accepts a number inside a sentence", () => {
    expect(matchSlotChoice("3 please", OFFERED, true)?.label).toBe("Mon-Fri 2pm");
  });

  it("accepts the label itself", () => {
    expect(matchSlotChoice("Sat 10am works", OFFERED, true)?.label).toBe("Sat 10am");
  });

  it("accepts the dated form it was written in", () => {
    // What the customer actually sees is "Sat Aug 22, 10am", so typing that
    // back has to count - it is the only wording they were given.
    const sat = OFFERED[3];
    expect(matchSlotChoice(`${sat.display} please`, OFFERED, true)?.key).toBe(sat.key);
  });

  it("returns null for a number outside the offered range", () => {
    // Booking slot 9 when four were offered would book the wrong time.
    expect(matchSlotChoice("9", OFFERED, true)).toBeNull();
  });

  it("returns null rather than guessing on an ambiguous reply", () => {
    expect(matchSlotChoice("either of those is fine", OFFERED, true)).toBeNull();
    expect(matchSlotChoice("", OFFERED, true)).toBeNull();
  });

  it("ignores a number when no slots were offered", () => {
    // The bug this guards: every inbound message was matched, so an ordinary
    // description of the problem booked an appointment and told the customer
    // they were confirmed.
    for (const message of [
      "It's been broken for 3 days",
      "I have 2 units",
      "6 year old system",
      "there are 3 bedrooms upstairs",
    ]) {
      expect(matchSlotChoice(message, OFFERED, false), message).toBeNull();
    }
  });

  it("still accepts an explicit label when no slots were offered", () => {
    // A label cannot be typed by accident, so it carries its own intent.
    expect(matchSlotChoice("can you do Sat 10am", OFFERED, false)?.label).toBe("Sat 10am");
  });

  it("does not read a rejection containing a digit as a choice", () => {
    // "none of those 3 work" carries a digit in range. Read as a pick it books
    // a visit the customer just said they could not make.
    expect(matchSlotChoice("none of those 3 work", OFFERED, true)).toBeNull();
  });
});

describe("wantsDifferentSlots", () => {
  it("recognises the ways customers turn down a set", () => {
    for (const message of [
      "none of those work",
      "None of these",
      "that doesn't work for me",
      "can't do any of them",
      "any other times?",
      "no",
    ]) {
      expect(wantsDifferentSlots(message), message).toBe(true);
    }
  });

  it("does not fire on a description of the problem", () => {
    // "no heat" starts with "no" and is the single most common opening
    // message this product receives. Treating it as a rejection would burn
    // three slots before any had been offered.
    for (const message of [
      "no heat since Friday",
      "no hot water",
      "there is no cold air coming out",
      "2 works for me",
    ]) {
      expect(wantsDifferentSlots(message), message).toBe(false);
    }
  });
});

describe("buildSlotOffer", () => {
  it("numbers the slots so a one-character reply is unambiguous", () => {
    const offer = buildSlotOffer([candidate("Mon-Fri 9am"), candidate("Sat 10am")]);

    expect(offer).toContain(`1) ${candidate("Mon-Fri 9am").display}`);
    expect(offer).toContain(`2) ${candidate("Sat 10am").display}`);
    expect(offer).toContain("reply with the number");
  });

  it("says these are different ones when offering a second set", () => {
    const offer = buildSlotOffer([candidate("Mon-Fri 9am")], true);

    expect(offer).toContain("next few");
  });
});

describe("bookSlot", () => {
  it("creates the appointment and moves the lead to BOOKED", async () => {
    const lead = await seedLead();

    const result = await bookSlot(lead, candidate("Mon-Fri 9am"));

    expect(result.appointment).not.toBeNull();
    expect(result.appointment?.slotLabel).toBe("Mon-Fri 9am");
    expect(result.appointment?.durationMinutes).toBe(90);

    const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated.status).toBe("BOOKED");
  });

  it("books the occurrence that was offered, not the next one", async () => {
    // The failure this guards: a customer who turns down everything sooner is
    // offered a slot two weeks out, and re-resolving the label on the way to
    // the database books them into this week instead - a date nobody agreed
    // to, confirmed by SMS.
    const lead = await seedLead();

    const soon = candidate("Mon-Fri 9am");
    const later = {
      ...soon,
      at: new Date(soon.at.getTime() + 7 * 24 * 60 * 60 * 1000),
    };
    later.key = buildScheduledSlotKey(later.label, later.at);
    later.display = formatSlotForCustomer(later.at);

    const result = await bookSlot(lead, later);

    expect(result.appointment?.scheduledAt?.toISOString()).toBe(later.at.toISOString());
    expect(result.appointment?.slotKey).toBe(later.key);
  });

  it("renders the confirmation with the business name and the chosen time", async () => {
    const lead = await seedLead();
    const sat = candidate("Sat 10am");
    const result = await bookSlot(lead, sat);

    // The dated wording, not the recurring window: "Sat 10am" alone does not
    // tell the customer which Saturday to be in.
    expect(result.confirmation).toContain(sat.display);
    expect(result.confirmation).not.toMatch(/\{\w+\}/);
  });

  it("refuses a slot that was never offered", async () => {
    const lead = await seedLead();

    const result = await bookSlot(lead, candidate("Sun 3am"));

    expect(result.appointment).toBeNull();
    expect(result.failure).toBe("no-slots");
  });

  it("removes a booked slot from availability", async () => {
    const lead = await seedLead();
    const chosen = candidate("Mon-Fri 9am");
    await bookSlot(lead, chosen);

    const available = await getAvailableSlots();

    // Asserted on the key, not the label. The same window recurs weekly, so
    // "Mon-Fri 9am" is expected to appear again for a later date - what must
    // not appear is this exact occurrence.
    expect(available.map((slot) => slot.key)).not.toContain(chosen.key);
  });

  it("offers only SLOT_OFFER_COUNT options at a time", async () => {
    process.env.SLOT_OFFER_COUNT = "3";
    resetEnvCache();

    const available = await getAvailableSlots();

    // Four windows over a three-week horizon is far more than three
    // occurrences; the cap is what keeps the text readable.
    expect(available).toHaveLength(3);
  });

  it("offers a different set once the first is excluded", async () => {
    process.env.SLOT_OFFER_COUNT = "3";
    resetEnvCache();

    const first = await getAvailableSlots();
    const second = await getAvailableSlots(
      new Date(),
      first.map((slot) => slot.key),
    );

    expect(second).toHaveLength(3);
    // No overlap at all: a second set that repeats what was just turned down
    // is what makes the assistant look like it is not listening.
    for (const slot of second) {
      expect(first.map((f) => f.key)).not.toContain(slot.key);
    }
    // And they are genuinely later, not a reshuffle.
    expect(second[0].at.getTime()).toBeGreaterThan(first[first.length - 1].at.getTime());
  });

  it("lets only one of two simultaneous bookings win the same slot", async () => {
    // The scenario the unique constraint exists for. Run sequentially and this
    // passes even with a read-then-write guard that both callers slip past.
    const [first, second] = await Promise.all([seedLead(), seedLead()]);

    // The same candidate object for both: contending for one occurrence is the
    // whole point, and two independently resolved candidates could in principle
    // land on different dates.
    const contested = candidate("Mon-Fri 11am");

    const results = await Promise.allSettled([
      bookSlot(first, contested),
      bookSlot(second, contested),
    ]);

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof bookSlot>>> =>
        r.status === "fulfilled",
    );

    const booked = fulfilled.filter((r) => r.value.appointment !== null);
    const rejected = fulfilled.filter((r) => r.value.failure === "slot-taken");

    expect(booked).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    expect(await prisma.appointment.count({ where: { slotLabel: "Mon-Fri 11am" } })).toBe(1);
  });

  it("reports not-configured when no slots are set up at all", async () => {
    // Calendar mode used to land here too. It no longer does: availability is
    // filtered against the real calendar in both modes now, so the only
    // deployment that cannot book is one with no configured windows.
    process.env.AVAILABLE_TIME_SLOTS = "";
    resetEnvCache();

    const lead = await seedLead();
    const result = await bookSlot(lead, candidate("Mon-Fri 9am"));

    expect(result.appointment).toBeNull();
    expect(result.failure).toBe("not-configured");
  });
});
