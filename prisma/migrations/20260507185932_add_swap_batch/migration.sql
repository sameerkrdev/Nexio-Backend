-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('SOL', 'USDT', 'LINK');

-- CreateEnum
CREATE TYPE "SwapStatus" AS ENUM ('pending', 'in_progress', 'completed', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "swap_batches" (
    "id" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "from_amount" DECIMAL(65,30) NOT NULL,
    "to_amount" DECIMAL(65,30),
    "tx_hash" TEXT,
    "status" "SwapStatus" NOT NULL DEFAULT 'pending',
    "quote_response" JSONB,
    "failure_reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "swap_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "swap_batches_tx_hash_key" ON "swap_batches"("tx_hash");

-- CreateIndex
CREATE INDEX "swap_batches_status_idx" ON "swap_batches"("status");

-- CreateIndex
CREATE INDEX "swap_batches_currency_status_idx" ON "swap_batches"("currency", "status");
