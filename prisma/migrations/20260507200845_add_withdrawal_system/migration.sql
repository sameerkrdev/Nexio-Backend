-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "WithdrawalMethod" AS ENUM ('UPI', 'BANK_TRANSFER', 'IMPS', 'NEFT', 'ZELLE', 'ACH', 'WIRE', 'FASTER_PAYMENTS', 'SEPA', 'SEPA_INSTANT', 'PAYNOW', 'FAST', 'ZENGIN', 'OSKO', 'NPP', 'INTERAC', 'EFT');

-- CreateEnum
CREATE TYPE "CountryCode" AS ENUM ('IN', 'US', 'GB', 'EU', 'JP', 'SG', 'AU', 'CA');

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "country_code" "CountryCode" NOT NULL,
    "local_currency" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "method" "WithdrawalMethod" NOT NULL,
    "country_code" "CountryCode" NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "nickname" TEXT,
    "encrypted_details" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "provider_name" TEXT NOT NULL DEFAULT 'mock',
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawal_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "fee_amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(65,30) NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'pending',
    "method" "WithdrawalMethod" NOT NULL,
    "country_code" "CountryCode" NOT NULL,
    "provider_name" TEXT NOT NULL DEFAULT 'mock',
    "provider_reference" TEXT,
    "provider_response" JSONB,
    "is_mocked" BOOLEAN NOT NULL DEFAULT true,
    "mock_completes_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "estimated_arrival" TEXT,
    "wallet_transaction_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- CreateIndex
CREATE INDEX "withdrawal_accounts_user_id_idx" ON "withdrawal_accounts"("user_id");

-- CreateIndex
CREATE INDEX "withdrawal_accounts_user_id_method_idx" ON "withdrawal_accounts"("user_id", "method");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_wallet_transaction_id_key" ON "withdrawals"("wallet_transaction_id");

-- CreateIndex
CREATE INDEX "withdrawals_user_id_created_at_idx" ON "withdrawals"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "withdrawals_status_idx" ON "withdrawals"("status");

-- CreateIndex
CREATE INDEX "withdrawals_wallet_id_idx" ON "withdrawals"("wallet_id");

-- CreateIndex
CREATE INDEX "withdrawals_status_mock_completes_at_idx" ON "withdrawals"("status", "mock_completes_at");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_accounts" ADD CONSTRAINT "withdrawal_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_accounts" ADD CONSTRAINT "withdrawal_accounts_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "withdrawal_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
