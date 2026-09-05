-- CreateIndex
CREATE INDEX "bookings_createdAt_idx" ON "bookings"("createdAt");

-- CreateIndex
CREATE INDEX "payments_status_paidAt_idx" ON "payments"("status", "paidAt");

-- CreateIndex
CREATE INDEX "refunds_status_completedAt_idx" ON "refunds"("status", "completedAt");
