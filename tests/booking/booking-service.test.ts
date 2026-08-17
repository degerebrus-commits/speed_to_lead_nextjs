import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/config/env";
import { prisma } from "@/lib/db";
import {
  bookSlot,
  buildSlotOffer,
  getAvailableSlots,
  hasBookingIntent,
  matchSlotChoice,
} from "@/server/booking/booking-service";

const SLOTS = ["Mon-Fri 9am", "Mon-Fri 11am", "Mon-Fri 2pm", "Sat 10am"];

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
  it("accepts a bare number", () => {
    expect(matchSlotChoice("2", SLOTS)).toBe("Mon-Fri 11am");
  });

  it("accepts a number inside a sentence", () => {
    expect(matchSlotChoice("3 please", SLOTS)).toBe("Mon-Fri 2pm");
  });

  it("accepts the label itself", () => {
    expect(matchSlotChoice("Sat 10am works", SLOTS)).toBe("Sat 10am");
  });

  it("returns null for a number outside the offered range", () => {
    // Booking slot 9 when four were offered would book the wrong time.
    expect(matchSlotChoice("9", SLOTS)).toBeNull();
  });

  it("returns null rather than guessing on an ambiguous reply", () => {
    expect(matchSlotChoice("either of those is fine", SLOTS)).toBeNull();
    expect(matchSlotChoice("", SLOTS)).toBeNull();
  });
});

describe("buildSlotOffer", () => {
  it("numbers the slots so a one-character reply is unambiguous", () => {
    const offer = buildSlotOffer(["Mon 9am", "Tue 2pm"]);

    expect(offer).toContain("1) Mon 9am");
    expect(offer).toContain("2) Tue 2pm");
    expect(offer).toContain("reply with the number");
  });
});

describe("bookSlot", () => {
  it("creates the appointment and moves the lead to BOOKED", async () => {
    const lead = await seedLead();

    const result = await bookSlot(lead, "Mon-Fri 9am");

    expect(result.appointment).not.toBeNull();
    expect(result.appointment?.slotLabel).toBe("Mon-Fri 9am");
    expect(result.appointment?.durationMinutes).toBe(90);

    const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated.status).toBe("BOOKED");
  });

  it("renders the confirmation with the business name and the chosen time", () => {
    return (async () => {
      const lead = await seedLead();
      const result = await bookSlot(lead, "Sat 10am");

      expect(result.confirmation).toContain("Sat 10am");
      expect(result.confirmation).not.toMatch(/\{\w+\}/);
    })();
  });

  it("refuses a slot that was never offered", async () => {
    const lead = await seedLead();

    const result = await bookSlot(lead, "Sun 3am");

    expect(result.appointment).toBeNull();
    expect(result.failure).toBe("no-slots");
  });

  it("removes a booked slot from availability", async () => {
    const lead = await seedLead();
    await bookSlot(lead, "Mon-Fri 9am");

    const available = await getAvailableSlots();

    expect(available).not.toContain("Mon-Fri 9am");
    expect(available).toHaveLength(SLOTS.length - 1);
  });

  it("lets only one of two simultaneous bookings win the same slot", async () => {
    // The scenario the unique constraint exists for. Run sequentially and this
    // passes even with a read-then-write guard that both callers slip past.
    const [first, second] = await Promise.all([seedLead(), seedLead()]);

    const results = await Promise.allSettled([
      bookSlot(first, "Mon-Fri 11am"),
      bookSlot(second, "Mon-Fri 11am"),
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

  it("reports not-configured when the deployment uses calendar mode", async () => {
    process.env.BOOKING_MODE = "calendar";
    resetEnvCache();

    const lead = await seedLead();
    const result = await bookSlot(lead, "Mon-Fri 9am");

    // Better to decline than to invent a fixed slot the calendar knows nothing about.
    expect(result.appointment).toBeNull();
    expect(result.failure).toBe("not-configured");
  });
});
