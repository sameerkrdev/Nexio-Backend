/*
  Warnings:

  - A unique constraint covering the columns `[external_payment_id]` on the table `withdrawals` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "withdrawals" DROP CONSTRAINT "withdrawals_account_id_fkey";

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "external_recipient_id" TEXT,
ADD COLUMN     "recipient_type" TEXT NOT NULL DEFAULT 'platform',
ALTER COLUMN "recipient_user_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "withdrawals" ADD COLUMN     "external_payment_id" TEXT,
ADD COLUMN     "is_external_payout" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "account_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "external_recipients" (
    "id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "country_code" "CountryCode" NOT NULL,
    "local_currency" TEXT NOT NULL,
    "method" "WithdrawalMethod" NOT NULL,
    "encrypted_details" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_recipients_phone_number_idx" ON "external_recipients"("phone_number");

-- CreateIndex
CREATE INDEX "payments_external_recipient_id_idx" ON "payments"("external_recipient_id");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_external_payment_id_key" ON "withdrawals"("external_payment_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_external_recipient_id_fkey" FOREIGN KEY ("external_recipient_id") REFERENCES "external_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "withdrawal_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
