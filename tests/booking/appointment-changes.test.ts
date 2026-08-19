import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetEnvCache } from "@/config/env";
import { prisma } from "@/lib/db";
import { handleCustomerReply } from "@/server/ai/conversation-service";
import { detectAppointmentIntent } from "@/server/booking/appointment-changes";
import {
  type SlotCandidate,
  bookSlot,
  getOpenSlotCandidates,
} from "@/server/booking/booking-service";
import {
  buildScheduledSlotKey,
  formatSlotForCustomer,
  resolveNextOccurrence,
} from "@/server/booking/slot-schedule";

/** The candidate the offer code would build for `label` as of `now`. */
function candidateAt(label: string, now: Date): SlotCandidate {
  const at = resolveNextOccurrence(label, now);
  if (at === null) throw new Error(`Test fixture: "${label}" does not resolve`);

  return { label, at, key: buildScheduledSlotKey(label, at), display: formatSlotForCustomer(at) };
}
import type { SmsMessage, SmsProvider } from "@/server/sms/sms-provider";
import { setSmsProviderForTesting } from "@/server/sms/sms-service";

const ORIGINAL = { ...process.env };
/**
 * Booked relative to the real clock, not a fixed instant.
 *
 * A hard-coded date made these specs time-dependent: bookSlot resolved the slot
 * against that date, while findActiveAppointment filters on the real now, so an
 * appointment booked for 14:00Z stopped being cancellable once the wall clock
 * passed 14:00Z. They passed all morning and failed after lunch.
 */
const AT = new Date();

let seq = 0;
async function seedLead() {
  seq += 1;
  return prisma.lead.create({
    data: {
      name: `Lead ${seq}`,
      phone: `+1555600${String(seq).padStart(4, "0")}`,
      serviceAddress: "1 Test Street",
      initialMessage: "No cooling.",
      dedupeKey: `chg-${seq}-${Date.now()}-${Math.random()}`,
      smsConsentAt: new Date(),
    },
  });
}

function installSpySms(): SmsMessage[] {
  const sent: SmsMessage[] = [];
  setSmsProviderForTesting({
    name: "spy",
    async send(message) {
      sent.push(message);
      return { providerMessageId: `spy-${sent.length}-${Math.random()}`, provider: "spy" };
    },
  } satisfies SmsProvider);
  return sent;
}

beforeEach(() => {
  process.env.BOOKING_MODE = "fixed";
  process.env.AVAILABLE_TIME_SLOTS = "Mon-Fri 9am,Mon-Fri 2pm,Sat 10am";
  process.env.BUSINESS_TIMEZONE = "America/Chicago";
  process.env.BUSINESS_OPEN_DAYS = "1,2,3,4,5,6,7";
  process.env.BUSINESS_OPEN_HOUR = "0";
  process.env.BUSINESS_CLOSE_HOUR = "24";
  process.env.EMERGENCY_KEYWORDS = "gas leak,carbon monoxide";
  resetEnvCache();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  resetEnvCache();
});

describe("detectAppointmentIntent", () => {
  it("recognises a cancellation", () => {
    for (const m of ["cancel my appointment", "Please cancel", "we no longer need it"]) {
      expect(detectAppointmentIntent(m), m).toBe("cancel");
    }
  });

  it("recognises a reschedule", () => {
    for (const m of ["can we reschedule", "move it to Thursday", "I need a different time"]) {
      expect(detectAppointmentIntent(m), m).toBe("reschedule");
    }
  });

  it("treats 'cancel and rebook' as a reschedule, not a cancellation", () => {
    // Dropping the customer when they asked to be moved is the worse error.
    expect(detectAppointmentIntent("cancel that and reschedule me")).toBe("reschedule");
  });

  it("does not fire on ordinary messages", () => {
    for (const m of ["my AC is broken", "what time can you come", "thanks"]) {
      expect(detectAppointmentIntent(m), m).toBeNull();
    }
  });
});

describe("cancelling", () => {
  it("frees the slot so someone else can book it", async () => {
    const sent = installSpySms();
    const lead = await seedLead();

    await bookSlot(lead, candidateAt("Mon-Fri 9am", AT));
    const bookedKey = candidateAt("Mon-Fri 9am", AT).key;
    expect((await getOpenSlotCandidates(AT)).map((s) => s.key)).not.toContain(bookedKey);

    const outcome = await handleCustomerReply(lead, "cancel my appointment please");

    expect(outcome.kind).toBe("cancelled");
    // The whole point: before this existed nothing set CANCELLED, so a slot
    // taken by mistake was gone until someone edited SQL by hand.
    expect((await getOpenSlotCandidates(AT)).map((s) => s.key)).toContain(bookedKey);
    expect(sent.at(-1)!.body).toContain("cancelled");
  });

  it("marks the appointment CANCELLED rather than deleting it", async () => {
    installSpySms();
    const lead = await seedLead();
    await bookSlot(lead, candidateAt("Mon-Fri 9am", AT));

    await handleCustomerReply(lead, "cancel please");

    const appointment = await prisma.appointment.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    // The record is history, not just state - deleting it loses that a visit
    // was ever arranged.
    expect(appointment.status).toBe("CANCELLED");
  });

  it("says so when there is nothing booked, rather than confirming a cancellation", async () => {
    const sent = installSpySms();
    const lead = await seedLead();

    const outcome = await handleCustomerReply(lead, "cancel my appointment");

    expect(outcome.kind).toBe("nothing-to-cancel");
    expect(sent.at(-1)!.body).toContain("nothing to cancel");
    expect(await prisma.appointment.count()).toBe(0);
  });
});

describe("rescheduling", () => {
  it("releases the old slot and offers times again, including the released one", async () => {
    const sent = installSpySms();
    const lead = await seedLead();
    const original = candidateAt("Mon-Fri 9am", AT);
    await bookSlot(lead, original);

    const outcome = await handleCustomerReply(lead, "can we reschedule");

    expect(outcome.kind).toBe("slots-offered");

    const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated.status).toBe("APPOINTMENT_PENDING");

    // Released first, so the customer is not told their own booking makes that
    // time unavailable. Asserted on the key rather than the label, because the
    // same weekly window appears on other dates regardless.
    expect(updated.offeredSlotKeys).toContain(original.key);
    expect(sent.at(-1)!.body).toContain(original.display);
  });

  it("lets the customer then pick a new slot", async () => {
    installSpySms();
    const lead = await seedLead();
    await bookSlot(lead, candidateAt("Mon-Fri 9am", AT));

    await handleCustomerReply(lead, "can we reschedule");
    const outcome = await handleCustomerReply(lead, "2");

    expect(outcome.kind).toBe("booked");

    const live = await prisma.appointment.findMany({
      where: { leadId: lead.id, status: "CONFIRMED" },
    });
    // Exactly one live appointment: the old one is cancelled, not duplicated.
    expect(live).toHaveLength(1);
  });
});

describe("ordering", () => {
  it("an emergency still outranks a cancellation", async () => {
    installSpySms();
    const lead = await seedLead();
    await bookSlot(lead, candidateAt("Mon-Fri 9am", AT));

    const outcome = await handleCustomerReply(lead, "cancel that, I smell a gas leak");

    expect(outcome.kind).toBe("emergency");
    expect(outcome.escalated).toBe(true);
  });
});
