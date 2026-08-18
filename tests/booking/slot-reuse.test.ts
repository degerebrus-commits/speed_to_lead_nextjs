import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetEnvCache } from "@/config/env";
import { prisma } from "@/lib/db";
import { bookSlot, getAvailableSlots } from "@/server/booking/booking-service";

const ORIGINAL = { ...process.env };

let seq = 0;
async function seedLead() {
  seq += 1;
  return prisma.lead.create({
    data: {
      name: `Lead ${seq}`,
      phone: `+1555700${String(seq).padStart(4, "0")}`,
      serviceAddress: "1 Test Street",
      initialMessage: "No cooling.",
      dedupeKey: `reuse-${seq}-${Date.now()}-${Math.random()}`,
      smsConsentAt: new Date(),
    },
  });
}

beforeEach(() => {
  process.env.BOOKING_MODE = "fixed";
  process.env.AVAILABLE_TIME_SLOTS = "Mon-Fri 9am,Sat 10am";
  process.env.APPOINTMENT_DURATION_MINUTES = "90";
  process.env.BUSINESS_TIMEZONE = "America/Chicago";
  resetEnvCache();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  resetEnvCache();
});

describe("a slot is reusable on a later date", () => {
  it("stores the real date and time of the visit", async () => {
    const lead = await seedLead();
    // 2026-08-18 is a Tuesday; 12:00 UTC is 07:00 in Chicago.
    const result = await bookSlot(lead, "Mon-Fri 9am", new Date("2026-08-18T12:00:00Z"));

    expect(result.appointment).not.toBeNull();
    expect(result.appointment!.scheduledAt).not.toBeNull();

    // 09:00 Chicago on the same Tuesday is 14:00 UTC.
    expect(result.appointment!.scheduledAt!.toISOString()).toBe("2026-08-18T14:00:00.000Z");
    // End follows the duration captured at booking time.
    expect(result.appointment!.scheduledEndAt!.toISOString()).toBe("2026-08-18T15:30:00.000Z");
  });

  it("lets the same weekly window be booked again the following week", async () => {
    // The bug this exists for: keyed on the label alone, "Mon-Fri 9am" could be
    // booked once in the lifetime of the deployment. Six configured slots meant
    // six appointments, ever.
    const first = await bookSlot(await seedLead(), "Mon-Fri 9am", new Date("2026-08-18T12:00:00Z"));
    const nextWeek = await bookSlot(await seedLead(), "Mon-Fri 9am", new Date("2026-08-25T12:00:00Z"));

    expect(first.appointment).not.toBeNull();
    expect(nextWeek.appointment).not.toBeNull();
    expect(nextWeek.failure).toBeNull();

    expect(await prisma.appointment.count()).toBe(2);
  });

  it("still refuses two bookings of the same slot on the same day", async () => {
    const at = new Date("2026-08-18T12:00:00Z");

    const first = await bookSlot(await seedLead(), "Mon-Fri 9am", at);
    const second = await bookSlot(await seedLead(), "Mon-Fri 9am", at);

    expect(first.appointment).not.toBeNull();
    expect(second.appointment).toBeNull();
    expect(second.failure).toBe("slot-taken");
  });

  it("refuses simultaneous bookings of the same slot, not just sequential ones", async () => {
    const at = new Date("2026-08-18T12:00:00Z");
    const [a, b] = await Promise.all([seedLead(), seedLead()]);

    // Run concurrently: a read-then-write guard passes this and books twice.
    const results = await Promise.allSettled([
      bookSlot(a, "Mon-Fri 9am", at),
      bookSlot(b, "Mon-Fri 9am", at),
    ]);

    const booked = results.filter(
      (r) => r.status === "fulfilled" && r.value.appointment !== null,
    );

    expect(booked).toHaveLength(1);
    expect(await prisma.appointment.count()).toBe(1);
  });

  it("frees the slot again once its date has passed", async () => {
    const at = new Date("2026-08-18T12:00:00Z");
    await bookSlot(await seedLead(), "Mon-Fri 9am", at);

    // Immediately after booking it is gone from the offer...
    expect(await getAvailableSlots(at)).not.toContain("Mon-Fri 9am");

    // ...and a week later it is offerable again, because the resolved date has
    // moved on.
    const later = await getAvailableSlots(new Date("2026-08-25T12:00:00Z"));
    expect(later).toContain("Mon-Fri 9am");
  });

  it("keeps offering an unbooked slot", async () => {
    const at = new Date("2026-08-18T12:00:00Z");
    await bookSlot(await seedLead(), "Mon-Fri 9am", at);

    expect(await getAvailableSlots(at)).toContain("Sat 10am");
  });
});
