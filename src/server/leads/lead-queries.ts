import type { AppointmentStatus, LeadStatus, MessageDirection } from "@prisma/client";

import { prisma } from "@/lib/db";

/** One row in the lead list. Kept narrow - the list renders nothing else. */
export interface LeadListItem {
  id: string;
  name: string;
  phone: string;
  status: LeadStatus;
  createdAt: Date;
  introSmsSentAt: Date | null;
  smsOptedOutAt: Date | null;
  /** Preview text for the row, taken from the most recent message. */
  lastMessageBody: string | null;
  lastMessageAt: Date | null;
  hasAppointment: boolean;
}

export interface LeadListPage {
  leads: LeadListItem[];
  /** Total matching the filter, for the pager. */
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ConversationMessage {
  id: string;
  direction: MessageDirection;
  body: string;
  createdAt: Date;
  sentAt: Date | null;
  receivedAt: Date | null;
}

export interface LeadAppointment {
  id: string;
  slotLabel: string;
  durationMinutes: number;
  status: AppointmentStatus;
  createdAt: Date;
  confirmationSentAt: Date | null;
}

export interface LeadDetail {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  serviceAddress: string;
  initialMessage: string;
  status: LeadStatus;
  createdAt: Date;
  introSmsSentAt: Date | null;
  smsOptedOutAt: Date | null;
  messages: ConversationMessage[];
  appointments: LeadAppointment[];
}

const DEFAULT_PAGE_SIZE = 25;

export async function listLeads(options?: {
  status?: LeadStatus;
  page?: number;
  pageSize?: number;
}): Promise<LeadListPage> {
  const page = Math.max(1, options?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options?.pageSize ?? DEFAULT_PAGE_SIZE));
  const where = options?.status ? { status: options.status } : {};

  const [total, rows] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        phone: true,
        status: true,
        createdAt: true,
        introSmsSentAt: true,
        smsOptedOutAt: true,
        // One message and one appointment per lead, rather than a count query
        // per row: the list is the most-visited screen and N+1 here would be
        // felt immediately.
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { body: true, createdAt: true },
        },
        appointments: {
          where: { status: { in: ["PENDING", "CONFIRMED", "COMPLETED"] } },
          take: 1,
          select: { id: true },
        },
      },
    }),
  ]);

  return {
    leads: rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      status: row.status,
      createdAt: row.createdAt,
      introSmsSentAt: row.introSmsSentAt,
      smsOptedOutAt: row.smsOptedOutAt,
      lastMessageBody: row.messages[0]?.body ?? null,
      lastMessageAt: row.messages[0]?.createdAt ?? null,
      hasAppointment: row.appointments.length > 0,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * A single lead with its full conversation. Returns null when the id does not
 * exist, so the page can render a 404 rather than throwing - a mistyped URL is
 * not an error condition.
 */
export async function getLeadDetail(id: string): Promise<LeadDetail | null> {
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      serviceAddress: true,
      initialMessage: true,
      status: true,
      createdAt: true,
      introSmsSentAt: true,
      smsOptedOutAt: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          direction: true,
          body: true,
          createdAt: true,
          sentAt: true,
          receivedAt: true,
        },
      },
      appointments: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          slotLabel: true,
          durationMinutes: true,
          status: true,
          createdAt: true,
          confirmationSentAt: true,
        },
      },
    },
  });

  return lead;
}

/** Counts per status, for the list's filter chips. Absent statuses are 0. */
export async function countLeadsByStatus(): Promise<Record<LeadStatus, number>> {
  const grouped = await prisma.lead.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  const counts = {} as Record<LeadStatus, number>;
  for (const row of grouped) {
    counts[row.status] = row._count._all;
  }

  return counts;
}
