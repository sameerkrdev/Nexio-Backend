import createHttpError from 'http-errors';
import Decimal from 'decimal.js';
import prisma from '../config/prisma.config';
import logger from '../config/logger.config';
import type { Prisma, WalletEntryReason } from '../generated/prisma/client';

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

interface RecordEntryParams {
  debitWalletId: string;
  creditWalletId: string;
  amount: Decimal.Value;
  currency: string;
  reason: WalletEntryReason;
  walletTransactionId?: string;
  referenceType?: string;
  referenceId?: string;
  note?: string;
  allowSameWalletEntry?: boolean;
}

export interface LedgerWalletFilters {
  from?: Date;
  to?: Date;
  reason?: WalletEntryReason;
  page: number;
  limit: number;
}

export const recordEntry = async (params: RecordEntryParams, tx: TxClient) => {
  const sameWallet = params.debitWalletId === params.creditWalletId;
  if (sameWallet && !params.allowSameWalletEntry) {
    throw createHttpError(400, 'Ledger entry must use different debit and credit wallets.');
  }
  if (sameWallet && params.reason !== 'fee_charged') {
    throw createHttpError(400, 'Same-wallet ledger entries are only allowed for fee_charged.');
  }

  return tx.ledgerEntry.create({
    data: {
      debitWalletId: params.debitWalletId,
      creditWalletId: params.creditWalletId,
      amount: new Decimal(params.amount).toString(),
      currency: params.currency,
      reason: params.reason,
      walletTransactionId: params.walletTransactionId,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      note: params.note,
    },
  });
};

export const getEntriesForWallet = async (walletId: string, filters: LedgerWalletFilters) => {
  const where: Prisma.LedgerEntryWhereInput = {
    OR: [{ debitWalletId: walletId }, { creditWalletId: walletId }],
    ...(filters.reason ? { reason: filters.reason } : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
  };

  const [total, data] = await Promise.all([
    prisma.ledgerEntry.count({ where }),
    prisma.ledgerEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
  ]);

  return {
    data,
    total,
    page: filters.page,
    limit: filters.limit,
    totalPages: Math.max(1, Math.ceil(total / filters.limit)),
  };
};

export const assertLedgerBalanced = async () => {
  const entries = await prisma.ledgerEntry.findMany({
    select: {
      debitWalletId: true,
      creditWalletId: true,
      amount: true,
    },
  });

  const totals = new Map<string, { debits: Decimal; credits: Decimal }>();

  for (const entry of entries) {
    const amount = new Decimal(entry.amount.toString());

    const debit = totals.get(entry.debitWalletId) ?? {
      debits: new Decimal(0),
      credits: new Decimal(0),
    };
    debit.debits = debit.debits.add(amount);
    totals.set(entry.debitWalletId, debit);

    const credit = totals.get(entry.creditWalletId) ?? {
      debits: new Decimal(0),
      credits: new Decimal(0),
    };
    credit.credits = credit.credits.add(amount);
    totals.set(entry.creditWalletId, credit);
  }

  const discrepancies: Array<{
    walletId: string;
    debits: string;
    credits: string;
    diff: string;
  }> = [];

  for (const [walletId, total] of totals.entries()) {
    const diff = total.credits.sub(total.debits);
    if (!diff.eq(0)) {
      discrepancies.push({
        walletId,
        debits: total.debits.toString(),
        credits: total.credits.toString(),
        diff: diff.toString(),
      });
    }
  }

  if (discrepancies.length > 0) {
    logger.error('Ledger imbalance detected', { discrepancies });
  } else {
    logger.info('Ledger balances verified', { walletsChecked: totals.size });
  }

  return {
    balanced: discrepancies.length === 0,
    discrepancies,
  };
};
