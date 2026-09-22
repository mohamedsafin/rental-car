-- AlterTable
ALTER TABLE "additional_charges" ADD COLUMN     "instalmentId" UUID;

-- AlterTable
ALTER TABLE "rental_instalments" ADD COLUMN     "extrasAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "additional_charges" ADD CONSTRAINT "additional_charges_instalmentId_fkey" FOREIGN KEY ("instalmentId") REFERENCES "rental_instalments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
