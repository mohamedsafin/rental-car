-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('INDIVIDUAL', 'CORPORATE');

-- CreateEnum
CREATE TYPE "FineType" AS ENUM ('TRAFFIC', 'PARKING', 'OTHER');

-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('DRAFT', 'ISSUED', 'SIGNED', 'VOID');

-- CreateEnum
CREATE TYPE "AccidentStatus" AS ENUM ('REPORTED', 'CLAIM_SUBMITTED', 'ASSESSED', 'IN_REPAIR', 'COMPLETED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ExpenseType" AS ENUM ('FINANCE', 'DEPRECIATION', 'INSURANCE', 'MAINTENANCE', 'TYRES', 'REGISTRATION', 'CLEANING', 'ACCIDENT', 'FUEL', 'SALIK', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'MANAGER';
ALTER TYPE "Role" ADD VALUE 'ACCOUNTANT';
ALTER TYPE "Role" ADD VALUE 'INSPECTOR';

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "companyName" TEXT,
ADD COLUMN     "companyTrn" TEXT,
ADD COLUMN     "customerType" "CustomerType" NOT NULL DEFAULT 'INDIVIDUAL';

-- AlterTable
ALTER TABLE "deposit_transactions" ADD COLUMN     "documentKey" TEXT,
ADD COLUMN     "documentName" TEXT;

-- AlterTable
ALTER TABLE "insurance_records" ADD COLUMN     "excessAmount" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "traffic_fines" ADD COLUMN     "documentKey" TEXT,
ADD COLUMN     "documentName" TEXT,
ADD COLUMN     "fineType" "FineType" NOT NULL DEFAULT 'TRAFFIC';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "branchId" UUID;

-- AlterTable
ALTER TABLE "vehicle_inspections" ADD COLUMN     "customerDeclinedAt" TIMESTAMPTZ(3),
ADD COLUMN     "customerSignatureKey" TEXT,
ADD COLUMN     "customerSignedAt" TIMESTAMPTZ(3),
ADD COLUMN     "customerSignedName" TEXT;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "currentValue" DECIMAL(12,2),
ADD COLUMN     "purchaseDate" DATE,
ADD COLUMN     "purchasePrice" DECIMAL(12,2),
ADD COLUMN     "vin" TEXT;

-- CreateTable
CREATE TABLE "rental_agreements" (
    "id" UUID NOT NULL,
    "agreementNumber" TEXT NOT NULL,
    "bookingId" UUID NOT NULL,
    "status" "AgreementStatus" NOT NULL DEFAULT 'ISSUED',
    "companyName" TEXT,
    "companyAddress" TEXT,
    "companyPhone" TEXT,
    "companyEmail" TEXT,
    "companyTrn" TEXT,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerPhone" TEXT,
    "customerAddress" TEXT,
    "licenceNumber" TEXT,
    "licenceExpiry" DATE,
    "emiratesIdNumber" TEXT,
    "passportNumber" TEXT,
    "vehicleDescription" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "vin" TEXT,
    "pickupMileage" INTEGER,
    "pickupAt" TIMESTAMPTZ(3) NOT NULL,
    "returnAt" TIMESTAMPTZ(3) NOT NULL,
    "pickupLocation" TEXT,
    "dropoffLocation" TEXT,
    "rentalDays" INTEGER NOT NULL,
    "rentalAmount" DECIMAL(10,2) NOT NULL,
    "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "securityDeposit" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "mileageLimitPerDay" INTEGER,
    "extraMileageCharge" DECIMAL(10,2),
    "fuelPolicy" TEXT,
    "insurerName" TEXT,
    "policyNumber" TEXT,
    "excessAmount" DECIMAL(10,2),
    "termsVersion" TEXT,
    "termsBody" TEXT,
    "customerSignedName" TEXT,
    "customerSignedAt" TIMESTAMPTZ(3),
    "customerSignatureKey" TEXT,
    "customerSignedIp" TEXT,
    "staffSignedName" TEXT,
    "staffSignedAt" TIMESTAMPTZ(3),
    "staffId" UUID,
    "voidReason" TEXT,
    "voidedAt" TIMESTAMPTZ(3),
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "additional_drivers" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "licenceNumber" TEXT NOT NULL,
    "licenceIssuingCountry" TEXT,
    "licenceExpiry" DATE,
    "phone" TEXT,
    "documentKey" TEXT,
    "documentName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "additional_drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accident_reports" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "vehicleId" UUID NOT NULL,
    "bookingId" UUID,
    "damageId" UUID,
    "status" "AccidentStatus" NOT NULL DEFAULT 'REPORTED',
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "location" TEXT,
    "description" TEXT NOT NULL,
    "policeReportNumber" TEXT,
    "policeReportDate" DATE,
    "insurerName" TEXT,
    "policyNumber" TEXT,
    "claimNumber" TEXT,
    "claimSubmittedAt" TIMESTAMPTZ(3),
    "claimSettledAt" TIMESTAMPTZ(3),
    "claimPaidAmount" DECIMAL(10,2),
    "excessAmount" DECIMAL(10,2),
    "customerLiability" DECIMAL(10,2),
    "garageName" TEXT,
    "repairEstimate" DECIMAL(10,2),
    "repairCost" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "offRoadFrom" TIMESTAMPTZ(3),
    "offRoadUntil" TIMESTAMPTZ(3),
    "notes" TEXT,
    "reportedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accident_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_expenses" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "type" "ExpenseType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "incurredAt" TIMESTAMPTZ(3) NOT NULL,
    "description" TEXT,
    "supplier" TEXT,
    "sourceType" TEXT,
    "sourceId" UUID,
    "documentKey" TEXT,
    "documentName" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rental_agreements_agreementNumber_key" ON "rental_agreements"("agreementNumber");

-- CreateIndex
CREATE UNIQUE INDEX "rental_agreements_bookingId_key" ON "rental_agreements"("bookingId");

-- CreateIndex
CREATE INDEX "rental_agreements_status_idx" ON "rental_agreements"("status");

-- CreateIndex
CREATE INDEX "additional_drivers_bookingId_idx" ON "additional_drivers"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "accident_reports_reference_key" ON "accident_reports"("reference");

-- CreateIndex
CREATE INDEX "accident_reports_vehicleId_idx" ON "accident_reports"("vehicleId");

-- CreateIndex
CREATE INDEX "accident_reports_status_idx" ON "accident_reports"("status");

-- CreateIndex
CREATE INDEX "vehicle_expenses_vehicleId_incurredAt_idx" ON "vehicle_expenses"("vehicleId", "incurredAt");

-- CreateIndex
CREATE INDEX "vehicle_expenses_type_idx" ON "vehicle_expenses"("type");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_expenses_sourceType_sourceId_key" ON "vehicle_expenses"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_vin_key" ON "vehicles"("vin");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_drivers" ADD CONSTRAINT "additional_drivers_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accident_reports" ADD CONSTRAINT "accident_reports_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accident_reports" ADD CONSTRAINT "accident_reports_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accident_reports" ADD CONSTRAINT "accident_reports_damageId_fkey" FOREIGN KEY ("damageId") REFERENCES "damages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accident_reports" ADD CONSTRAINT "accident_reports_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_expenses" ADD CONSTRAINT "vehicle_expenses_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_expenses" ADD CONSTRAINT "vehicle_expenses_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

