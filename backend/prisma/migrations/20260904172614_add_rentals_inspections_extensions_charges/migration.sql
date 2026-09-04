-- CreateEnum
CREATE TYPE "RentalStatus" AS ENUM ('ACTIVE', 'RETURNED', 'CLOSED');

-- CreateEnum
CREATE TYPE "InspectionType" AS ENUM ('PICKUP', 'RETURN');

-- CreateEnum
CREATE TYPE "InspectionPhotoType" AS ENUM ('FRONT', 'REAR', 'LEFT_SIDE', 'RIGHT_SIDE', 'INTERIOR', 'DASHBOARD', 'ODOMETER', 'DAMAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "ExtensionStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "ChargeType" AS ENUM ('LATE_RETURN', 'EXCESS_MILEAGE', 'FUEL', 'CLEANING', 'DAMAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('PENDING', 'SETTLED_FROM_DEPOSIT', 'INVOICED', 'WAIVED');

-- CreateTable
CREATE TABLE "rentals" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "status" "RentalStatus" NOT NULL DEFAULT 'ACTIVE',
    "pickedUpAt" TIMESTAMPTZ(3) NOT NULL,
    "returnedAt" TIMESTAMPTZ(3),
    "pickupMileage" INTEGER NOT NULL,
    "returnMileage" INTEGER,
    "pickupFuelPercent" INTEGER NOT NULL,
    "returnFuelPercent" INTEGER,
    "handedOverById" UUID,
    "receivedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rentals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_inspections" (
    "id" UUID NOT NULL,
    "rentalId" UUID NOT NULL,
    "type" "InspectionType" NOT NULL,
    "mileage" INTEGER NOT NULL,
    "fuelPercent" INTEGER NOT NULL,
    "conditionNotes" TEXT,
    "cleanliness" TEXT,
    "accessories" JSONB,
    "damageNotes" TEXT,
    "inspectedById" UUID,
    "customerVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_photos" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "type" "InspectionPhotoType" NOT NULL DEFAULT 'OTHER',
    "storageKey" TEXT NOT NULL,
    "caption" TEXT,
    "sizeBytes" INTEGER,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_extensions" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "originalReturnAt" TIMESTAMPTZ(3) NOT NULL,
    "requestedReturnAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "ExtensionStatus" NOT NULL DEFAULT 'REQUESTED',
    "additionalDays" INTEGER NOT NULL,
    "additionalAmount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "rejectionReason" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "additional_charges" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "type" "ChargeType" NOT NULL,
    "status" "ChargeStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "description" TEXT NOT NULL,
    "calculation" JSONB,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "additional_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rentals_bookingId_key" ON "rentals"("bookingId");

-- CreateIndex
CREATE INDEX "rentals_status_idx" ON "rentals"("status");

-- CreateIndex
CREATE INDEX "vehicle_inspections_rentalId_idx" ON "vehicle_inspections"("rentalId");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_inspections_rentalId_type_key" ON "vehicle_inspections"("rentalId", "type");

-- CreateIndex
CREATE INDEX "inspection_photos_inspectionId_idx" ON "inspection_photos"("inspectionId");

-- CreateIndex
CREATE INDEX "booking_extensions_bookingId_idx" ON "booking_extensions"("bookingId");

-- CreateIndex
CREATE INDEX "booking_extensions_status_idx" ON "booking_extensions"("status");

-- CreateIndex
CREATE INDEX "additional_charges_bookingId_idx" ON "additional_charges"("bookingId");

-- CreateIndex
CREATE INDEX "additional_charges_status_idx" ON "additional_charges"("status");

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_handedOverById_fkey" FOREIGN KEY ("handedOverById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "rentals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_inspectedById_fkey" FOREIGN KEY ("inspectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "vehicle_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_extensions" ADD CONSTRAINT "booking_extensions_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_extensions" ADD CONSTRAINT "booking_extensions_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_charges" ADD CONSTRAINT "additional_charges_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_charges" ADD CONSTRAINT "additional_charges_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
