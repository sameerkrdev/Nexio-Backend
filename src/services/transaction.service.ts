import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import Decimal from 'decimal.js';
import type { Currency } from '../generated/prisma/client';
import { TOKENS } from '../config/tokens';
import { toTokenUnits } from '../utils/amount';
import { buildMemoInstruction } from '../utils/memo';
import { connection, getNexioPublicKey, withRpcRetry } from '../utils/solana';

interface BuildTransactionParams {
  paymentId: string;
  senderPublicKey: string;
  currency: Currency;
  totalAmount: string;
}

export const buildPaymentTransaction = async (
  params: BuildTransactionParams,
): Promise<{ transaction: Transaction; transactionBase64: string }> => {
  const sender = new PublicKey(params.senderPublicKey);
  const nexio = getNexioPublicKey();
  const transaction = new Transaction();
  transaction.feePayer = sender;

  const instructions: TransactionInstruction[] = [buildMemoInstruction(params.paymentId)];

  if (params.currency === 'SOL') {
    const lamports = toTokenUnits(params.totalAmount, TOKENS.SOL.decimals);
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: sender,
        toPubkey: nexio,
        lamports,
      }),
    );
  } else {
    const token = TOKENS[params.currency];
    if (!token.mint) {
      throw new Error(`Missing mint for ${params.currency}`);
    }

    const senderAta = getAssociatedTokenAddressSync(token.mint, sender, false);
    const nexioAta = getAssociatedTokenAddressSync(token.mint, nexio, false);
    const nexioAtaInfo = await withRpcRetry((conn) => conn.getAccountInfo(nexioAta));

    if (!nexioAtaInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(sender, nexioAta, nexio, token.mint),
      );
    }

    const units = new Decimal(params.totalAmount)
      .mul(new Decimal(10).pow(token.decimals))
      .toFixed(0, Decimal.ROUND_HALF_UP);

    instructions.push(
      createTransferCheckedInstruction(
        senderAta,
        token.mint,
        nexioAta,
        sender,
        BigInt(units),
        token.decimals,
      ),
    );
  }

  instructions.forEach((instruction) => transaction.add(instruction));
  const latestBlockhash = await withRpcRetry((conn) => conn.getLatestBlockhash('confirmed'));
  transaction.recentBlockhash = latestBlockhash.blockhash;

  const serialized = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return {
    transaction,
    transactionBase64: Buffer.from(serialized).toString('base64'),
  };
};

export const getNexioAtaStatus = async (): Promise<Record<'USDT' | 'USDC' | 'LINK', boolean>> => {
  const nexio = getNexioPublicKey();
  const usdtMint = TOKENS.USDT.mint;
  const usdcMint = TOKENS.USDC.mint;
  const linkMint = TOKENS.LINK.mint;
  if (!usdtMint || !usdcMint || !linkMint) {
    throw new Error('Missing token mints');
  }

  const usdtAta = getAssociatedTokenAddressSync(usdtMint, nexio, false);
  const usdcAta = getAssociatedTokenAddressSync(usdcMint, nexio, false);
  const linkAta = getAssociatedTokenAddressSync(linkMint, nexio, false);
  const [usdtInfo, usdcInfo, linkInfo] = await Promise.all([
    withRpcRetry((conn) => conn.getAccountInfo(usdtAta)),
    withRpcRetry((conn) => conn.getAccountInfo(usdcAta)),
    withRpcRetry((conn) => conn.getAccountInfo(linkAta)),
  ]);

  return {
    USDT: !!usdtInfo,
    USDC: !!usdcInfo,
    LINK: !!linkInfo,
  };
};

export { connection };
