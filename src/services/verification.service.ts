import { z } from 'zod';
import Decimal from 'decimal.js';
import type { Currency } from '../generated/prisma/client';
import env from '../config/dotenv.config';
import { TOKENS } from '../config/tokens';

export const heliusInstructionSchema = z.object({
  programId: z.string().optional(),
  data: z.string().optional(),
});

export const heliusNativeTransferSchema = z.object({
  fromUserAccount: z.string().optional(),
  toUserAccount: z.string(),
  amount: z.number(),
});

export const heliusTokenTransferSchema = z.object({
  fromUserAccount: z.string().optional(),
  toUserAccount: z.string(),
  mint: z.string(),
  tokenAmount: z.number(),
});

export const heliusTransactionSchema = z.object({
  signature: z.string(),
  nativeTransfers: z.array(heliusNativeTransferSchema).default([]),
  tokenTransfers: z.array(heliusTokenTransferSchema).default([]),
  instructions: z.array(heliusInstructionSchema).default([]),
});

export type HeliusEnhancedTransaction = z.infer<typeof heliusTransactionSchema>;

export const parseHeliusPayload = (payload: unknown): HeliusEnhancedTransaction[] => {
  return z.array(heliusTransactionSchema).parse(payload);
};

export const validatePaymentTransfer = (params: {
  tx: HeliusEnhancedTransaction;
  currency: Currency;
  expectedTotalAmount: string;
  nexioWallet: string;
}): { ok: boolean; reason?: string } => {
  const { tx, currency, expectedTotalAmount, nexioWallet } = params;

  console.log('+========= i AM IN VALIDATE ==========');

  if (currency === 'SOL') {
    const transfer = tx.nativeTransfers.find((item) => item.toUserAccount === nexioWallet);
    if (!transfer) return { ok: false, reason: 'invalid_receiver' };

    const expectedLamports = new Decimal(expectedTotalAmount).mul('1000000000');
    const receivedLamports = new Decimal(transfer.amount);
    const comparison = receivedLamports.comparedTo(expectedLamports);

    if (comparison < 0) return { ok: false, reason: 'insufficient_amount' };
    if (comparison > 0 && !env.ACCEPT_OVERPAYMENT)
      return { ok: false, reason: 'overpayment_not_allowed' };
    console.log('+========= i AM IN VALIDATE END ==========');
    return { ok: true };
  }

  const token = TOKENS[currency];
  if (!token.mint) return { ok: false, reason: 'missing_token_mint' };

  console.log('+========= i AM IN VALIDATE 1 ==========');

  const transfer = tx.tokenTransfers.find(
    (item) => item.toUserAccount === nexioWallet && item.mint === token.mint!.toBase58(),
  );
  if (!transfer) return { ok: false, reason: 'invalid_receiver_or_mint' };

  console.log('+========= i AM IN VALIDATE 2 ==========');

  const expected = new Decimal(expectedTotalAmount);
  const received = new Decimal(transfer.tokenAmount);
  const comparison = received.comparedTo(expected);

  console.log('+========= i AM IN VALIDATE 3 ==========');

  if (comparison < 0) return { ok: false, reason: 'insufficient_amount' };
  if (comparison > 0 && !env.ACCEPT_OVERPAYMENT)
    return { ok: false, reason: 'overpayment_not_allowed' };

  return { ok: true };
};
