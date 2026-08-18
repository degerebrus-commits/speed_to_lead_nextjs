-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "smsConsentAt" TIMESTAMP(3),
ADD COLUMN     "smsConsentSource" TEXT,
ADD COLUMN     "smsConsentText" TEXT;
