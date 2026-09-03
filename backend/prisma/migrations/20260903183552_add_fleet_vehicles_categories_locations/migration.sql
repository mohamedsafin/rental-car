-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'RENTED', 'UNDER_INSPECTION', 'UNDER_MAINTENANCE', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "Transmission" AS ENUM ('AUTOMATIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC');

-- CreateEnum
CREATE TYPE "VehicleImageType" AS ENUM ('EXTERIOR_FRONT', 'EXTERIOR_REAR', 'EXTERIOR_LEFT', 'EXTERIOR_RIGHT', 'INTERIOR_DASHBOARD', 'INTERIOR_FRONT', 'INTERIOR_REAR', 'INTERIOR_SEATS', 'OTHER');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('OFFICE', 'AIRPORT', 'HOTEL', 'DELIVERY_AREA');

-- CreateTable
CREATE TABLE "vehicle_categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vehicle_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_features" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_features_on_vehicles" (
    "vehicleId" UUID NOT NULL,
    "featureId" UUID NOT NULL,

    CONSTRAINT "vehicle_features_on_vehicles_pkey" PRIMARY KEY ("vehicleId","featureId")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "variant" TEXT,
    "registrationNumber" TEXT NOT NULL,
    "categoryId" UUID NOT NULL,
    "seats" INTEGER NOT NULL,
    "doors" INTEGER NOT NULL DEFAULT 4,
    "transmission" "Transmission" NOT NULL,
    "fuelType" "FuelType" NOT NULL,
    "color" TEXT,
    "dailyPrice" DECIMAL(10,2) NOT NULL,
    "weeklyPrice" DECIMAL(10,2),
    "monthlyPrice" DECIMAL(10,2),
    "securityDeposit" DECIMAL(10,2) NOT NULL,
    "mileageLimitPerDay" INTEGER,
    "extraMileageCharge" DECIMAL(10,2),
    "status" "VehicleStatus" NOT NULL DEFAULT 'AVAILABLE',
    "currentMileage" INTEGER NOT NULL DEFAULT 0,
    "locationId" UUID,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_images" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "type" "VehicleImageType" NOT NULL DEFAULT 'OTHER',
    "altText" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "sizeBytes" INTEGER,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "LocationType" NOT NULL DEFAULT 'OFFICE',
    "address" TEXT,
    "emirate" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "workingHours" JSONB,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "deliveryCharge" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "isPickupPoint" BOOLEAN NOT NULL DEFAULT true,
    "isDropoffPoint" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_categories_name_key" ON "vehicle_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_categories_slug_key" ON "vehicle_categories"("slug");

-- CreateIndex
CREATE INDEX "vehicle_categories_isActive_idx" ON "vehicle_categories"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_features_name_key" ON "vehicle_features"("name");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_features_slug_key" ON "vehicle_features"("slug");

-- CreateIndex
CREATE INDEX "vehicle_features_on_vehicles_featureId_idx" ON "vehicle_features_on_vehicles"("featureId");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_registrationNumber_key" ON "vehicles"("registrationNumber");

-- CreateIndex
CREATE INDEX "vehicles_categoryId_idx" ON "vehicles"("categoryId");

-- CreateIndex
CREATE INDEX "vehicles_status_idx" ON "vehicles"("status");

-- CreateIndex
CREATE INDEX "vehicles_isPublished_deletedAt_idx" ON "vehicles"("isPublished", "deletedAt");

-- CreateIndex
CREATE INDEX "vehicles_locationId_idx" ON "vehicles"("locationId");

-- CreateIndex
CREATE INDEX "vehicle_images_vehicleId_idx" ON "vehicle_images"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "locations_slug_key" ON "locations"("slug");

-- CreateIndex
CREATE INDEX "locations_type_idx" ON "locations"("type");

-- CreateIndex
CREATE INDEX "locations_isActive_idx" ON "locations"("isActive");

-- AddForeignKey
ALTER TABLE "vehicle_features_on_vehicles" ADD CONSTRAINT "vehicle_features_on_vehicles_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_features_on_vehicles" ADD CONSTRAINT "vehicle_features_on_vehicles_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "vehicle_features"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "vehicle_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_images" ADD CONSTRAINT "vehicle_images_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
