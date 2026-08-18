import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { countLeadsByStatus, getLeadDetail, listLeads } from "@/server/leads/lead-queries";

let counter = 0;

async function createLead(overrides?: {
  name?: string;
  status?: "NEW" | "ENGAGED" | "BOOKED";
  createdAt?: Date;
  introSmsSentAt?: Date | null;
  smsOptedOutAt?: Date | null;
}) {
  counter += 1;

  return prisma.lead.create({
    data: {
      name: overrides?.name ?? `Lead ${counter}`,
      phone: `+1555100${String(counter).padStart(4, "0")}`,
      email: null,
      serviceAddress: "9 Elm Road",
      initialMessage: "Furnace making a grinding noise.",
      dedupeKey: `queries-${counter}-${Date.now()}`,
      status: overrides?.status ?? "NEW",
      createdAt: overrides?.createdAt ?? new Date(),
      introSmsSentAt: overrides?.introSmsSentAt ?? null,
      smsOptedOutAt: overrides?.smsOptedOutAt ?? null,
    },
  });
}

describe("listLeads", () => {
  it("returns an empty page rather than throwing when there are no leads", async () => {
    const result = await listLeads();

    expect(result.leads).toEqual([]);
    expect(result.total).toBe(0);
    // One page, not zero - the pager renders "Page 1 of 1", never "of 0".
    expect(result.totalPages).toBe(1);
  });

  it("orders newest first", async () => {
    await createLead({ name: "Older", createdAt: new Date("2026-03-01T10:00:00Z") });
    await createLead({ name: "Newer", createdAt: new Date("2026-03-05T10:00:00Z") });

    const result = await listLeads();

    expect(result.leads.map((lead) => lead.name)).toEqual(["Newer", "Older"]);
  });

  it("previews the most recent message and flags an appointment", async () => {
    const lead = await createLead({ name: "Has history" });

    await prisma.message.create({
      data: {
        leadId: lead.id,
        direction: "OUTBOUND",
        phone: lead.phone,
        body: "First contact",
        provider: "test",
        createdAt: new Date("2026-03-01T10:00:00Z"),
      },
    });
    await prisma.message.create({
      data: {
        leadId: lead.id,
        direction: "INBOUND",
        phone: lead.phone,
        body: "Most recent reply",
        provider: "test",
        createdAt: new Date("2026-03-02T10:00:00Z"),
      },
    });
    await prisma.appointment.create({
      data: {
        leadId: lead.id,
        slotLabel: "Thu 2pm-4pm",
        durationMinutes: 120,
        slotKey: `list-slot-${lead.id}`,
      },
    });

    const result = await listLeads();

    expect(result.leads[0].lastMessageBody).toBe("Most recent reply");
    expect(result.leads[0].hasAppointment).toBe(true);
  });

  it("does not flag an appointment that was cancelled", async () => {
    const lead = await createLead();

    await prisma.appointment.create({
      data: {
        leadId: lead.id,
        slotLabel: "Fri 9am-11am",
        durationMinutes: 120,
        slotKey: `cancelled-${lead.id}`,
        status: "CANCELLED",
      },
    });

    const result = await listLeads();

    // A cancelled slot must not read as a booking on the list, or the owner
    // sees coverage that no longer exists.
    expect(result.leads[0].hasAppointment).toBe(false);
  });

  it("filters by status", async () => {
    await createLead({ name: "New one", status: "NEW" });
    await createLead({ name: "Booked one", status: "BOOKED" });

    const result = await listLeads({ status: "BOOKED" });

    expect(result.leads.map((lead) => lead.name)).toEqual(["Booked one"]);
    expect(result.total).toBe(1);
  });

  it("paginates, and reports a total covering every page", async () => {
    for (let index = 0; index < 5; index += 1) {
      await createLead({ createdAt: new Date(2026, 2, index + 1) });
    }

    const first = await listLeads({ page: 1, pageSize: 2 });
    const last = await listLeads({ page: 3, pageSize: 2 });

    expect(first.leads).toHaveLength(2);
    expect(last.leads).toHaveLength(1);
    // The total is every matching lead, not the size of this page - the pager
    // depends on the difference.
    expect(first.total).toBe(5);
    expect(first.totalPages).toBe(3);
  });

  it("clamps a page number below 1 instead of computing a negative offset", async () => {
    await createLead();

    const result = await listLeads({ page: 0 });

    expect(result.page).toBe(1);
    expect(result.leads).toHaveLength(1);
  });
});

describe("getLeadDetail", () => {
  it("returns null for an unknown id rather than throwing", async () => {
    expect(await getLeadDetail("does-not-exist")).toBeNull();
  });

  it("returns the conversation oldest first, with both directions", async () => {
    const lead = await createLead({ name: "Talkative" });

    await prisma.message.create({
      data: {
        leadId: lead.id,
        direction: "INBOUND",
        phone: lead.phone,
        body: "Second",
        provider: "test",
        createdAt: new Date("2026-03-02T10:00:00Z"),
      },
    });
    await prisma.message.create({
      data: {
        leadId: lead.id,
        direction: "OUTBOUND",
        phone: lead.phone,
        body: "First",
        provider: "test",
        createdAt: new Date("2026-03-01T10:00:00Z"),
      },
    });

    const detail = await getLeadDetail(lead.id);

    expect(detail?.messages.map((message) => message.body)).toEqual(["First", "Second"]);
    expect(detail?.messages.map((message) => message.direction)).toEqual([
      "OUTBOUND",
      "INBOUND",
    ]);
  });

  it("carries the fields the detail page renders", async () => {
    const lead = await createLead({
      name: "Full record",
      introSmsSentAt: new Date("2026-03-01T10:01:00Z"),
    });

    const detail = await getLeadDetail(lead.id);

    expect(detail?.serviceAddress).toBe("9 Elm Road");
    expect(detail?.initialMessage).toBe("Furnace making a grinding noise.");
    expect(detail?.introSmsSentAt).not.toBeNull();
  });

  it("includes appointments so the page can show the booked slot", async () => {
    const lead = await createLead();

    await prisma.appointment.create({
      data: {
        leadId: lead.id,
        slotLabel: "Mon 8am-10am",
        durationMinutes: 90,
        slotKey: `detail-${lead.id}`,
      },
    });

    const detail = await getLeadDetail(lead.id);

    expect(detail?.appointments).toHaveLength(1);
    expect(detail?.appointments[0].slotLabel).toBe("Mon 8am-10am");
    expect(detail?.appointments[0].durationMinutes).toBe(90);
  });
});

describe("countLeadsByStatus", () => {
  it("counts each status present", async () => {
    await createLead({ status: "NEW" });
    await createLead({ status: "NEW" });
    await createLead({ status: "BOOKED" });

    const counts = await countLeadsByStatus();

    expect(counts.NEW).toBe(2);
    expect(counts.BOOKED).toBe(1);
    // Absent statuses are undefined rather than 0; the filter chips render
    // only the ones with leads behind them.
    expect(counts.LOST).toBeUndefined();
  });
});
