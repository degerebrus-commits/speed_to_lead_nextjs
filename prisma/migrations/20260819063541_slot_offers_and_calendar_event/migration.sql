-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "calendarEventId" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "declinedSlotKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "offeredSlotKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];
