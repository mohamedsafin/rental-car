-- CreateEnum
CREATE TYPE "DamageType" AS ENUM ('SCRATCH', 'DENT', 'BROKEN_PART', 'INTERIOR', 'TYRE', 'GLASS', 'MECHANICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "DamageStatus" AS ENUM ('REPORTED', 'ASSESSED', 'APPROVED', 'DISMISSED', 'CHARGED');

-- CreateEnum
CREATE TYPE "ChargeRecoveryStatus" AS ENUM ('RECORDED', 'ASSIGNED', 'RECOVERED', 'WAIVED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('ROUTINE_SERVICE', 'REPAIR', 'TYRE_CHANGE', 'BODYWORK', 'INSPECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VehicleDocumentType" AS ENUM ('REGISTRATION', 'INSURANCE', 'REGISTRATION_RENEWAL', 'INSURANCE_RENEWAL', 'MAINTENANCE_RECORD', 'INSPECTION_REPORT', 'OTHER');

-- CreateTable
CREATE TABLE "damages" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "bookingId" UUID,
    "type" "DamageType" NOT NULL,
    "status" "DamageStatus" NOT NULL DEFAULT 'REPORTED',
    "description" TEXT NOT NULL,
    "location" TEXT,
    "estimatedAmount" DECIMAL(10,2),
    "approvedAmount" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "assessmentNotes" TEXT,
    "reportedById" UUID,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "damages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_photos" (
    "id" UUID NOT NULL,
    "damageId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "caption" TEXT,
    "sizeBytes" INTEGER,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "damage_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traffic_fines" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "bookingId" UUID,
    "fineNumber" TEXT NOT NULL,
    "violationAt" TIMESTAMPTZ(3) NOT NULL,
    "violation" TEXT,
    "location" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "serviceFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "status" "ChargeRecoveryStatus" NOT NULL DEFAULT 'RECORDED',
    "notes" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "traffic_fines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "toll_charges" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "bookingId" UUID,
    "crossedAt" TIMESTAMPTZ(3) NOT NULL,
    "gate" TEXT,
    "reference" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "serviceFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "status" "ChargeRecoveryStatus" NOT NULL DEFAULT 'RECORDED',
    "notes" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "toll_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_records" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "type" "MaintenanceType" NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "description" TEXT NOT NULL,
    "provider" TEXT,
    "mileage" INTEGER,
    "cost" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "nextServiceAt" TIMESTAMP(3),
    "nextServiceMileage" INTEGER,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_records" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "coverType" TEXT,
    "startDate" DATE NOT NULL,
    "expiryDate" DATE NOT NULL,
    "premium" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_documents" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "type" "VehicleDocumentType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "documentNumber" TEXT,
    "issueDate" DATE,
    "expiryDate" DATE,
    "notes" TEXT,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "damages_vehicleId_idx" ON "damages"("vehicleId");

-- CreateIndex
CREATE INDEX "damages_bookingId_idx" ON "damages"("bookingId");

-- CreateIndex
CREATE INDEX "damages_status_idx" ON "damages"("status");

-- CreateIndex
CREATE INDEX "damage_photos_damageId_idx" ON "damage_photos"("damageId");

-- CreateIndex
CREATE UNIQUE INDEX "traffic_fines_fineNumber_key" ON "traffic_fines"("fineNumber");

-- CreateIndex
CREATE INDEX "traffic_fines_vehicleId_idx" ON "traffic_fines"("vehicleId");

-- CreateIndex
CREATE INDEX "traffic_fines_bookingId_idx" ON "traffic_fines"("bookingId");

-- CreateIndex
CREATE INDEX "traffic_fines_status_idx" ON "traffic_fines"("status");

-- CreateIndex
CREATE INDEX "traffic_fines_violationAt_idx" ON "traffic_fines"("violationAt");

-- CreateIndex
CREATE INDEX "toll_charges_vehicleId_idx" ON "toll_charges"("vehicleId");

-- CreateIndex
CREATE INDEX "toll_charges_bookingId_idx" ON "toll_charges"("bookingId");

-- CreateIndex
CREATE INDEX "toll_charges_status_idx" ON "toll_charges"("status");

-- CreateIndex
CREATE INDEX "toll_charges_crossedAt_idx" ON "toll_charges"("crossedAt");

-- CreateIndex
CREATE INDEX "maintenance_records_vehicleId_startsAt_endsAt_idx" ON "maintenance_records"("vehicleId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "maintenance_records_status_idx" ON "maintenance_records"("status");

-- CreateIndex
CREATE INDEX "insurance_records_vehicleId_isActive_idx" ON "insurance_records"("vehicleId", "isActive");

-- CreateIndex
CREATE INDEX "insurance_records_expiryDate_idx" ON "insurance_records"("expiryDate");

-- CreateIndex
CREATE INDEX "vehicle_documents_vehicleId_idx" ON "vehicle_documents"("vehicleId");

-- CreateIndex
CREATE INDEX "vehicle_documents_expiryDate_idx" ON "vehicle_documents"("expiryDate");

-- AddForeignKey
ALTER TABLE "damages" ADD CONSTRAINT "damages_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damages" ADD CONSTRAINT "damages_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damages" ADD CONSTRAINT "damages_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damages" ADD CONSTRAINT "damages_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_photos" ADD CONSTRAINT "damage_photos_damageId_fkey" FOREIGN KEY ("damageId") REFERENCES "damages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traffic_fines" ADD CONSTRAINT "traffic_fines_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traffic_fines" ADD CONSTRAINT "traffic_fines_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traffic_fines" ADD CONSTRAINT "traffic_fines_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toll_charges" ADD CONSTRAINT "toll_charges_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toll_charges" ADD CONSTRAINT "toll_charges_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toll_charges" ADD CONSTRAINT "toll_charges_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_records" ADD CONSTRAINT "insurance_records_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
