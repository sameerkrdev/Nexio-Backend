import { z } from 'zod';
import Decimal from 'decimal.js';
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
  cryptoType: string;
  expectedTotalAmount: string;
  nexioWallet: string;
}): { ok: boolean; reason?: string } => {
  const { tx, cryptoType, expectedTotalAmount, nexioWallet } = params;
  const normalizedType = cryptoType.toUpperCase() as keyof typeof TOKENS;
  if (!(normalizedType in TOKENS)) {
    return { ok: false, reason: 'unsupported_crypto_type' };
  }

  if (normalizedType === 'SOL') {
    const transfer = tx.nativeTransfers.find((item) => item.toUserAccount === nexioWallet);
    if (!transfer) {
      console.log('❌ No transfer found to Nexio wallet', {
        nexioWallet,
        nativeTransfers: tx.nativeTransfers,
      });
      return { ok: false, reason: 'invalid_receiver' };
    }

    // Convert to lamports and round to integer (lamports cannot have decimals)
    const expectedLamports = new Decimal(expectedTotalAmount)
      .mul('1000000000')
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    const receivedLamports = new Decimal(transfer.amount);
    const comparison = receivedLamports.comparedTo(expectedLamports);

    console.log('💰 Payment validation:', {
      expectedSOL: expectedTotalAmount,
      expectedLamports: expectedLamports.toString(),
      receivedLamports: receivedLamports.toString(),
      difference: receivedLamports.minus(expectedLamports).toString(),
      comparison: comparison === 0 ? 'exact' : comparison < 0 ? 'insufficient' : 'overpayment',
    });

    if (comparison < 0) return { ok: false, reason: 'insufficient_amount' };
    if (comparison > 0 && !env.ACCEPT_OVERPAYMENT)
      return { ok: false, reason: 'overpayment_not_allowed' };
    return { ok: true };
  }

  const token = TOKENS[normalizedType];
  if (!token.mint) return { ok: false, reason: 'missing_token_mint' };

  const transfer = tx.tokenTransfers.find(
    (item) => item.toUserAccount === nexioWallet && item.mint === token.mint!.toBase58(),
  );
  if (!transfer) return { ok: false, reason: 'invalid_receiver_or_mint' };

  // Convert to token units and round to integer (token amounts use integer units based on decimals)
  const expected = new Decimal(expectedTotalAmount)
    .mul(new Decimal(10).pow(token.decimals))
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const received = new Decimal(transfer.tokenAmount);
  const comparison = received.comparedTo(expected);

  if (comparison < 0) return { ok: false, reason: 'insufficient_amount' };
  if (comparison > 0 && !env.ACCEPT_OVERPAYMENT)
    return { ok: false, reason: 'overpayment_not_allowed' };

  return { ok: true };
};
