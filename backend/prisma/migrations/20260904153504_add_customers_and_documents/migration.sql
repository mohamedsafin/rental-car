-- CreateEnum
CREATE TYPE "ResidencyStatus" AS ENUM ('UAE_RESIDENT', 'VISITOR');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('EMIRATES_ID', 'UAE_DRIVING_LICENCE', 'PASSPORT', 'VISA', 'DRIVING_LICENCE', 'INTERNATIONAL_DRIVING_PERMIT', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "residencyStatus" "ResidencyStatus",
    "dateOfBirth" DATE,
    "nationality" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "emirate" TEXT,
    "country" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "licenceNumber" TEXT,
    "licenceIssuingCountry" TEXT,
    "licenceIssueDate" DATE,
    "licenceExpiryDate" DATE,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_documents" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "type" "DocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "documentNumber" TEXT,
    "issuingCountry" TEXT,
    "issueDate" DATE,
    "expiryDate" DATE,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "supersededAt" TIMESTAMP(3),
    "supersededById" UUID,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_userId_key" ON "customers"("userId");

-- CreateIndex
CREATE INDEX "customers_isVerified_idx" ON "customers"("isVerified");

-- CreateIndex
CREATE INDEX "customer_documents_customerId_status_idx" ON "customer_documents"("customerId", "status");

-- CreateIndex
CREATE INDEX "customer_documents_status_idx" ON "customer_documents"("status");

-- CreateIndex
CREATE INDEX "customer_documents_expiryDate_idx" ON "customer_documents"("expiryDate");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "customer_documents_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "customer_documents_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
