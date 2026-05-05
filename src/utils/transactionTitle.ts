import Decimal from 'decimal.js';
import type { WalletEntryReason, WalletTransactionType } from '../generated/prisma/client';

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
};

interface PaymentReceivedTitleParams {
  localAmount: Decimal.Value;
  currency: string;
  cryptoAmount: Decimal.Value;
  token: string;
}

interface WithdrawalInitiatedTitleParams {
  displayName: string;
}

type TitleParams = PaymentReceivedTitleParams | WithdrawalInitiatedTitleParams | undefined;

const formatMoney = (amount: Decimal.Value) => new Decimal(amount).toFixed(2);

export const generateTitle = (
  type: WalletTransactionType,
  reason: WalletEntryReason,
  params?: TitleParams,
): string => {
  if (type === 'credit' && reason === 'payment_received') {
    const paymentParams = params as PaymentReceivedTitleParams | undefined;
    const currency = paymentParams?.currency?.toUpperCase() ?? 'INR';
    const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
    const localAmount = formatMoney(paymentParams?.localAmount ?? 0);
    const cryptoAmount = formatMoney(paymentParams?.cryptoAmount ?? 0);
    const token = paymentParams?.token ?? '';
    return `Received ${symbol}${localAmount} (${cryptoAmount} ${token})`;
  }

  if (type === 'debit' && reason === 'withdrawal_initiated') {
    const withdrawalParams = params as WithdrawalInitiatedTitleParams | undefined;
    return `Withdrawal to ${withdrawalParams?.displayName ?? 'recipient'}`;
  }

  if (type === 'credit' && reason === 'withdrawal_refunded') {
    return 'Withdrawal refunded';
  }

  if (type === 'credit' && reason === 'admin_credit') {
    return 'Account credit';
  }

  if (type === 'debit' && reason === 'admin_debit') {
    return 'Account adjustment';
  }

  return type === 'credit' ? 'Account credit' : 'Account adjustment';
};
