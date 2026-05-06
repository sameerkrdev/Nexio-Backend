/*
  Warnings:

  - You are about to drop the column `amount` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `currency` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `fee_breakdown` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `total_amount` on the `payments` table. All the data in the column will be lost.
  - Added the required column `crypto_amount` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `crypto_to_sender_rate` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `crypto_type` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `platform_fee_amount` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `platform_fee_crypto` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `platform_fee_percent` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `rate_snapshot_at` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `rate_source` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `receiver_currency` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `receiver_currency_amount` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sender_currency` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sender_currency_amount` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sender_to_receiver_rate` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `total_crypto_amount` to the `payments` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "payments" DROP COLUMN "amount",
DROP COLUMN "currency",
DROP COLUMN "fee_breakdown",
DROP COLUMN "total_amount",
ADD COLUMN     "crypto_amount" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "crypto_to_sender_rate" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "crypto_type" TEXT NOT NULL,
ADD COLUMN     "platform_fee_amount" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "platform_fee_crypto" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "platform_fee_percent" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "rate_snapshot_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "rate_source" TEXT NOT NULL,
ADD COLUMN     "receiver_currency" TEXT NOT NULL,
ADD COLUMN     "receiver_currency_amount" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "sender_currency" TEXT NOT NULL,
ADD COLUMN     "sender_currency_amount" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "sender_to_receiver_rate" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "total_crypto_amount" DECIMAL(65,30) NOT NULL;

-- DropEnum
DROP TYPE "Currency";
