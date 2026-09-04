-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'PAYMENT_PENDING', 'DOCUMENT_VERIFICATION', 'CONFIRMED', 'READY_FOR_PICKUP', 'ACTIVE', 'EXTENSION_REQUESTED', 'RETURN_PENDING', 'RETURNED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServiceChargeType" AS ENUM ('PER_BOOKING', 'PER_DAY');

-- CreateEnum
CREATE TYPE "PricingRuleType" AS ENUM ('WEEKEND', 'SEASONAL', 'LONG_TERM_DISCOUNT');

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "bookingNumber" TEXT NOT NULL,
    "vehicleId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "pickupLocationId" UUID,
    "dropoffLocationId" UUID,
    "pickupAt" TIMESTAMPTZ(3) NOT NULL,
    "returnAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "holdExpiresAt" TIMESTAMPTZ(3),
    "rentalDays" INTEGER NOT NULL,
    "vehicleSubtotal" DECIMAL(10,2) NOT NULL,
    "servicesSubtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "securityDeposit" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "additional_services" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "chargeType" "ServiceChargeType" NOT NULL DEFAULT 'PER_BOOKING',
    "maxQuantity" INTEGER NOT NULL DEFAULT 1,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "additional_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PricingRuleType" NOT NULL,
    "vehicleId" UUID,
    "categoryId" UUID,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "minDays" INTEGER,
    "adjustmentPercentage" DECIMAL(5,2) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_bookingNumber_key" ON "bookings"("bookingNumber");

-- CreateIndex
CREATE INDEX "bookings_vehicleId_pickupAt_returnAt_idx" ON "bookings"("vehicleId", "pickupAt", "returnAt");

-- CreateIndex
CREATE INDEX "bookings_customerId_idx" ON "bookings"("customerId");

-- CreateIndex
CREATE INDEX "bookings_status_idx" ON "bookings"("status");

-- CreateIndex
CREATE INDEX "bookings_pickupAt_idx" ON "bookings"("pickupAt");

-- CreateIndex
CREATE UNIQUE INDEX "additional_services_name_key" ON "additional_services"("name");

-- CreateIndex
CREATE UNIQUE INDEX "additional_services_slug_key" ON "additional_services"("slug");

-- CreateIndex
CREATE INDEX "additional_services_isActive_idx" ON "additional_services"("isActive");

-- CreateIndex
CREATE INDEX "pricing_rules_type_isActive_idx" ON "pricing_rules"("type", "isActive");

-- CreateIndex
CREATE INDEX "pricing_rules_vehicleId_idx" ON "pricing_rules"("vehicleId");

-- CreateIndex
CREATE INDEX "pricing_rules_categoryId_idx" ON "pricing_rules"("categoryId");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_pickupLocationId_fkey" FOREIGN KEY ("pickupLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_dropoffLocationId_fkey" FOREIGN KEY ("dropoffLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "vehicle_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- DOUBLE-BOOKING PREVENTION AT THE DATABASE LEVEL
-- ---------------------------------------------------------------------------
-- Hand-written: Prisma cannot express an exclusion constraint in schema.prisma.
--
-- Why this exists when the service already checks for overlaps:
--
--   An application-level check is a READ followed by a WRITE. Two requests for
--   the same car can both run the read, both see "free", and both insert. The
--   window is milliseconds - but a launch-day promotion is exactly when two
--   people click Book at the same instant, and the result is one car promised
--   to two customers.
--
--   PostgreSQL evaluates this constraint inside the INSERT itself. The second
--   transaction cannot succeed, no matter how the application is written or
--   how many API servers are running behind the load balancer.
--
-- btree_gist lets one GiST index mix an equality column (vehicleId) with a
-- range column (the rental window).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- '[)' = inclusive start, EXCLUSIVE end. THIS is the rule that makes a booking
-- ending 15 Sep 10:00 and one starting 15 Sep 10:00 both valid: the first range
-- stops just short of the instant the second begins. BRD 34 asks for exactly
-- this behaviour to be decided and documented.
--
-- The WHERE clause lists only the statuses that actually hold a vehicle.
-- CANCELLED, COMPLETED and RETURNED rows stay for history but must not block.
-- PENDING is excluded because its hold EXPIRES - a time-dependent rule cannot
-- live in an immutable index, so the service enforces that one.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlapping_rental"
  EXCLUDE USING gist (
    "vehicleId" WITH =,
    tstzrange("pickupAt", "returnAt", '[)') WITH &&
  )
  WHERE (
    "status" IN (
      'PAYMENT_PENDING',
      'DOCUMENT_VERIFICATION',
      'CONFIRMED',
      'READY_FOR_PICKUP',
      'ACTIVE',
      'EXTENSION_REQUESTED',
      'RETURN_PENDING'
    )
  );

-- A rental must end after it starts. Cheap, and it rules out a whole class of
-- nonsense including negative-duration bookings, which would price at zero.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_return_after_pickup"
  CHECK ("returnAt" > "pickupAt");
