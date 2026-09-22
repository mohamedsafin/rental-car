-- AlterTable
ALTER TABLE "booking_extensions" ADD COLUMN     "additionalSubtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "additionalTax" DECIMAL(10,2) NOT NULL DEFAULT 0;
