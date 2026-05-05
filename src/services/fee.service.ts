import Decimal from 'decimal.js';
import type { Currency } from '../generated/prisma/client';
import env from '../config/dotenv.config';
import { lamportsToSol } from '../utils/amount';
import { withRpcRetry } from '../utils/solana';
import type { Transaction } from '@solana/web3.js';

export interface FeeBreakdown {
  [key: string]: string | Currency;
  baseAmount: string;
  networkFee: string;
  networkFeeCurrency: 'SOL';
  serviceFee: string;
  totalAmount: string;
  currency: Currency;
}

export const calculateAmounts = (amount: string, currency: Currency) => {
  const baseAmount = new Decimal(amount);
  const serviceFee = baseAmount.mul(env.SERVICE_FEE_PERCENT).div(100);
  const totalAmount = baseAmount.add(serviceFee);

  return {
    baseAmount: baseAmount.toString(),
    serviceFee: serviceFee.toString(),
    totalAmount: totalAmount.toString(),
    currency,
  };
};

export const estimateNetworkFee = async (transaction: Transaction): Promise<string> => {
  const fee = await withRpcRetry(async (connection) =>
    connection.getFeeForMessage(transaction.compileMessage(), 'confirmed'),
  );

  const feeLamports = BigInt(fee.value ?? 0);
  return lamportsToSol(feeLamports);
};

export const buildFeeBreakdown = (params: {
  amount: string;
  currency: Currency;
  networkFee: string;
}): FeeBreakdown => {
  const computed = calculateAmounts(params.amount, params.currency);
  return {
    ...computed,
    networkFee: params.networkFee,
    networkFeeCurrency: 'SOL',
  };
};
