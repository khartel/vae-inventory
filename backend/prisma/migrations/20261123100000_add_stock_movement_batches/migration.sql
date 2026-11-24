ALTER TABLE "StockMovement" ADD COLUMN "batchId" TEXT;

-- Returns already have an exact operation reference; preserve that grouping.
UPDATE "StockMovement" SET "batchId" = "returnId" WHERE "returnId" IS NOT NULL;

CREATE INDEX "StockMovement_businessId_batchId_idx" ON "StockMovement"("businessId", "batchId");
