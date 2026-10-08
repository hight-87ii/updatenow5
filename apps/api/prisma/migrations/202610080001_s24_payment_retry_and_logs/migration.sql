-- AlterTable
ALTER TABLE "payments" ADD COLUMN "attemptNo" INTEGER NOT NULL DEFAULT 1;

-- Number any existing multiple payments per order chronologically
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "orderId" ORDER BY "createdAt" ASC) as row_num
  FROM "payments"
)
UPDATE "payments" p
SET "attemptNo" = numbered.row_num
FROM numbered
WHERE p.id = numbered.id;

-- CreateIndex
CREATE UNIQUE INDEX "payments_orderId_attemptNo_key" ON "payments"("orderId", "attemptNo");

-- CreateTable
CREATE TABLE "order_logs" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "attemptNo" INTEGER,
    "detail" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_logs_orderId_idx" ON "order_logs"("orderId");

-- AddForeignKey
ALTER TABLE "order_logs" ADD CONSTRAINT "order_logs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
