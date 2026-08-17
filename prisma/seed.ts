import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

const prisma = new PrismaClient();

/**
 * Sample data for local development only. The country code follows the same
 * configuration the application uses, so seeding a deployment outside +1 does
 * not produce numbers the rest of the system would reject.
 */
const countryCode = process.env.BUSINESS_COUNTRY_CODE ?? "+1";

/**
 * Mirrors buildDedupeKey() in src/server/leads/lead-service.ts. The seed script
 * runs standalone under tsx without path aliases, so the two-line hash is
 * repeated here rather than dragging alias config into the seed.
 */
function seedDedupeKey(phone: string, message: string): string {
  return createHash("sha256").update(`${phone}:${message.trim()}`).digest("hex");
}

/** The four development scenarios named in README.md. */
const developmentLeads = [
  {
    name: "John Carter",
    nationalNumber: "5125550142",
    email: "john.carter@example.com",
    serviceAddress: "42 Oak Street, Springfield",
    initialMessage: "My AC is running but the house isn't getting cool.",
  },
  {
    name: "Maria Delgado",
    nationalNumber: "5125550188",
    email: null,
    serviceAddress: "1180 Pine Avenue, Springfield",
    initialMessage: "My furnace isn't heating the house.",
  },
  {
    name: "Dwayne Foster",
    nationalNumber: "5125550107",
    email: "d.foster@example.com",
    serviceAddress: "9 Cedar Court, Springfield",
    initialMessage: "I'd like to schedule HVAC maintenance.",
  },
  {
    name: "Priya Raman",
    nationalNumber: "5125550163",
    email: "praman@example.com",
    serviceAddress: "755 Maple Drive, Springfield",
    initialMessage: "I think I need a new AC system. Can someone give me an estimate?",
  },
];

async function main() {
  for (const { nationalNumber, ...lead } of developmentLeads) {
    const phone = `${countryCode}${nationalNumber}`;
    const dedupeKey = seedDedupeKey(phone, lead.initialMessage);

    // Upsert so re-running the seed is safe and never duplicates a lead.
    await prisma.lead.upsert({
      where: { dedupeKey },
      update: {},
      create: { ...lead, phone, dedupeKey },
    });
  }

  console.log(`Seed complete. Lead rows in database: ${await prisma.lead.count()}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
