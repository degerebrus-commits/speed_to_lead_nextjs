-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "scheduledEndAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Appointment_scheduledAt_idx" ON "Appointment"("scheduledAt");
