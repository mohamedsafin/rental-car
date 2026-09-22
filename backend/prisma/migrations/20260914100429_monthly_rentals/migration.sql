-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('UPFRONT', 'MONTHLY');

-- CreateEnum
CREATE TYPE "InstalmentStatus" AS ENUM ('SCHEDULED', 'DUE', 'PAID', 'CANCELLED');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "billingCycle" "BillingCycle" NOT NULL DEFAULT 'UPFRONT',
ADD COLUMN     "termMonths" INTEGER;

-- CreateTable
CREATE TABLE "rental_instalments" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "status" "InstalmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "paymentId" UUID,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_instalments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rental_instalments_paymentId_key" ON "rental_instalments"("paymentId");

-- CreateIndex
CREATE INDEX "rental_instalments_status_dueAt_idx" ON "rental_instalments"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "rental_instalments_bookingId_sequence_key" ON "rental_instalments"("bookingId", "sequence");

-- AddForeignKey
ALTER TABLE "rental_instalments" ADD CONSTRAINT "rental_instalments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_instalments" ADD CONSTRAINT "rental_instalments_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
