-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "instalmentId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "invoices_instalmentId_key" ON "invoices"("instalmentId");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_instalmentId_fkey" FOREIGN KEY ("instalmentId") REFERENCES "rental_instalments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

