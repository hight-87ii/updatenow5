CREATE TYPE "ReconciliationLineType" AS ENUM ('MATCHED', 'SYSTEM_ONLY', 'PROVIDER_ONLY', 'AMOUNT_MISMATCH');
CREATE TABLE "reconciliation_runs" (
  "id" UUID NOT NULL, "createdById" UUID NOT NULL, "provider" TEXT NOT NULL,
  "fileName" TEXT NOT NULL, "periodStart" TIMESTAMPTZ(3) NOT NULL,
  "periodEnd" TIMESTAMPTZ(3) NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "reconciliation_lines" (
  "id" UUID NOT NULL, "runId" UUID NOT NULL, "type" "ReconciliationLineType" NOT NULL,
  "transactionId" TEXT NOT NULL, "gatewayRef" TEXT, "paymentId" UUID,
  "systemAmount" INTEGER, "providerAmount" INTEGER, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reconciliation_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reconciliation_runs_createdAt_idx" ON "reconciliation_runs"("createdAt");
CREATE INDEX "reconciliation_lines_runId_type_idx" ON "reconciliation_lines"("runId", "type");
CREATE INDEX "reconciliation_lines_transactionId_idx" ON "reconciliation_lines"("transactionId");
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reconciliation_lines" ADD CONSTRAINT "reconciliation_lines_runId_fkey" FOREIGN KEY ("runId") REFERENCES "reconciliation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
