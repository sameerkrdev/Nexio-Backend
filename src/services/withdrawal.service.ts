import createHttpError from 'http-errors';
import Decimal from 'decimal.js';
import env from '../config/dotenv.config';
import logger from '../config/logger.config';
import { getPaymentRail } from '../config/paymentRails';
import prisma from '../config/prisma.config';
import type {
  CountryCode,
  Prisma,
  Withdrawal,
  WithdrawalMethod,
  WithdrawalStatus,
} from '../generated/prisma/client';
import { WithdrawalMethod as WithdrawalMethodEnum } from '../generated/prisma/client';
import { detectCountryFromPhone } from '../utils/countryDetect';
import { generateTitle } from '../utils/transactionTitle';
import {
  debitWallet,
  creditWallet,
  getOrCreateWallet,
  InsufficientBalanceError,
} from './wallet.service';
import { getProvider } from './providers/provider.interface';
import { MockProviderError } from './providers/mock.provider';

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const lockWalletRow = async (walletId: string, tx: TxClient) => {
  await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${walletId} FOR UPDATE`;
};

const methodDescriptions: Partial<Record<WithdrawalMethod, string>> = {
  UPI: 'Instant · Any UPI app',
  BANK_TRANSFER: 'Bank transfer to registered account',
  IMPS: 'Fast bank transfer',
  NEFT: 'Scheduled bank settlement',
  ZELLE: 'US domestic instant transfer',
  ACH: 'US ACH transfer',
  WIRE: 'International/domestic wire transfer',
  FASTER_PAYMENTS: 'UK instant bank transfer',
  SEPA: 'European SEPA transfer',
  SEPA_INSTANT: 'Instant SEPA transfer',
  PAYNOW: 'Singapore PayNow transfer',
  FAST: 'Singapore FAST transfer',
  ZENGIN: 'Japan domestic transfer',
  OSKO: 'Australia near-real-time transfer',
  NPP: 'Australia NPP transfer',
  INTERAC: 'Canada Interac transfer',
  EFT: 'Canada EFT transfer',
};

const methodEstimatedTime: Partial<Record<WithdrawalMethod, string>> = {
  UPI: 'Instantly',
  PAYNOW: 'Instantly',
  FAST: 'Instantly',
  SEPA_INSTANT: 'Instantly',
  IMPS: 'Within minutes',
  FASTER_PAYMENTS: 'Within minutes',
  OSKO: 'Within minutes',
  NPP: 'Within minutes',
  ZELLE: 'Within minutes',
  NEFT: 'Within 1-2 hours',
  ACH: '1-2 business days',
  INTERAC: 'Within 1 business day',
  EFT: '1-2 business days',
  SEPA: '1-2 business days',
  BANK_TRANSFER: '1-3 business days',
  WIRE: '1-3 business days',
  ZENGIN: '1-2 business days',
};

const parseAmount = (value: Decimal.Value, fieldName: string) => {
  try {
    return new Decimal(value);
  } catch {
    throw createHttpError(400, `${fieldName} must be a valid decimal`);
  }
};

const toDecimalString = (value: Decimal.Value) => new Decimal(value).toString();

const getDailyLimitForCurrency = (currency: string) => {
  const upper = currency.toUpperCase();
  const map: Record<string, number> = {
    INR: env.WITHDRAWAL_DAILY_LIMIT_INR,
    USD: env.WITHDRAWAL_DAILY_LIMIT_USD,
    EUR: env.WITHDRAWAL_DAILY_LIMIT_EUR,
    GBP: env.WITHDRAWAL_DAILY_LIMIT_GBP,
    JPY: env.WITHDRAWAL_DAILY_LIMIT_JPY,
    SGD: env.WITHDRAWAL_DAILY_LIMIT_SGD,
    AUD: env.WITHDRAWAL_DAILY_LIMIT_AUD,
    CAD: env.WITHDRAWAL_DAILY_LIMIT_CAD,
  };
  return map[upper] ?? env.WITHDRAWAL_DAILY_LIMIT_USD;
};

const getFeeAmountByMethod = (method: WithdrawalMethod, amount: Decimal) => {
  switch (method) {
    case 'UPI':
    case 'PAYNOW':
    case 'FASTER_PAYMENTS':
    case 'FAST':
    case 'NPP':
    case 'OSKO':
    case 'BANK_TRANSFER':
    case 'ZELLE':
    case 'EFT':
      return new Decimal(0);
    case 'IMPS':
      return new Decimal(env.WITHDRAWAL_FEE_IMPS);
    case 'NEFT':
      return new Decimal(env.WITHDRAWAL_FEE_NEFT);
    case 'WIRE':
      return new Decimal(env.WITHDRAWAL_FEE_WIRE);
    case 'ZENGIN':
      return new Decimal(env.WITHDRAWAL_FEE_ZENGIN);
    case 'INTERAC':
      return new Decimal(env.WITHDRAWAL_FEE_INTERAC);
    case 'SEPA':
      return new Decimal(env.WITHDRAWAL_FEE_SEPA);
    case 'ACH': {
      const percentFee = amount.mul(env.WITHDRAWAL_FEE_ACH_PERCENT).div(100);
      const minFee = new Decimal(env.WITHDRAWAL_FEE_ACH_MIN);
      return Decimal.max(percentFee, minFee);
    }
    case 'SEPA_INSTANT':
      return amount.mul(env.WITHDRAWAL_FEE_SEPA_INSTANT_PERCENT).div(100);
    default:
      return new Decimal(0);
  }
};

const getFeeDescription = (method: WithdrawalMethod, feeAmount: Decimal, currency: string) => {
  if (feeAmount.eq(0)) {
    return 'Free';
  }
  switch (method) {
    case 'ACH':
      return `${env.WITHDRAWAL_FEE_ACH_PERCENT}% (min ${env.WITHDRAWAL_FEE_ACH_MIN} ${currency})`;
    case 'SEPA_INSTANT':
      return `${env.WITHDRAWAL_FEE_SEPA_INSTANT_PERCENT}%`;
    default:
      return `${feeAmount.toFixed(2)} ${currency}`;
  }
};

const serializeWithdrawal = (
  withdrawal: Withdrawal & {
    account?: {
      displayName: string;
    } | null;
  },
) => ({
  id: withdrawal.id,
  amount: withdrawal.amount.toString(),
  feeAmount: withdrawal.feeAmount.toString(),
  netAmount: withdrawal.netAmount.toString(),
  currency: withdrawal.currency,
  method: withdrawal.method,
  status: withdrawal.status,
  destination: withdrawal.account?.displayName ?? null,
  estimatedArrival: withdrawal.estimatedArrival,
  isMocked: withdrawal.isMocked,
  providerReference: withdrawal.providerReference,
  failureReason: withdrawal.failureReason,
  createdAt: withdrawal.createdAt,
  completedAt: withdrawal.completedAt,
});

export class DailyLimitExceededError extends Error {
  constructor(public readonly resetHours: number) {
    super(`Daily withdrawal limit reached. Resets in ${resetHours}h`);
    this.name = 'DailyLimitExceededError';
  }
}

export const getAvailableMethods = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phoneNumber: true },
  });
  if (!user) {
    throw createHttpError(404, 'User not found.');
  }

  const countryCode = detectCountryFromPhone(user.phoneNumber);
  const rail = getPaymentRail(countryCode);
  if (!rail) {
    throw createHttpError(400, 'No withdrawal methods available for your region');
  }

  const allMethods = Object.values(WithdrawalMethodEnum);

  return {
    countryCode,
    currency: rail.currency,
    isMocked: true,
    defaultMethod: rail.defaultMethod,
    methods: allMethods.map((method) => {
      const isAvailableForUser = rail.methods.includes(method);
      const limits = isAvailableForUser ? rail.limits[method] : null;
      const fee = isAvailableForUser
        ? getWithdrawalFee(method, new Decimal(limits.min), rail.currency)
        : null;
      return {
        method,
        label: method,
        description: methodDescriptions[method] ?? 'Standard payout method',
        estimatedTime: methodEstimatedTime[method] ?? 'Within 1-3 business days',
        fee: fee?.feeDescription ?? null,
        minAmount: limits ? String(limits.min) : null,
        maxAmount: limits ? String(limits.max) : null,
        isMocked: true,
        isAvailableForUser,
      };
    }),
    availableMethods: rail.methods.map((method) => {
      const fee = getWithdrawalFee(method, new Decimal(rail.limits[method].min), rail.currency);
      return {
        method,
        label: method,
        description: methodDescriptions[method] ?? 'Standard payout method',
        estimatedTime: methodEstimatedTime[method] ?? 'Within 1-3 business days',
        fee: fee.feeDescription,
        minAmount: String(rail.limits[method].min),
        maxAmount: String(rail.limits[method].max),
        isMocked: true,
      };
    }),
  };
};

export const getWithdrawalFee = (
  method: WithdrawalMethod,
  amount: Decimal.Value,
  currency: string,
) => {
  const parsedAmount = parseAmount(amount, 'amount');
  const feeAmount = getFeeAmountByMethod(method, parsedAmount);
  return {
    feeAmount,
    feeDescription: getFeeDescription(method, feeAmount, currency),
  };
};

export const checkDailyLimit = async (userId: string, amount: Decimal.Value, currency: string) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const aggregate = await prisma.withdrawal.aggregate({
    where: {
      userId,
      currency: currency.toUpperCase(),
      status: { in: ['pending', 'processing', 'completed'] },
      createdAt: { gte: since },
    },
    _sum: {
      amount: true,
    },
  });

  const aggregateSum = aggregate as { _sum?: { amount?: Decimal | null } };
  const currentTotal = new Decimal(aggregateSum._sum?.amount?.toString() ?? '0');
  const requestedAmount = parseAmount(amount, 'amount');
  const dailyLimit = new Decimal(getDailyLimitForCurrency(currency));
  if (currentTotal.add(requestedAmount).gt(dailyLimit)) {
    throw new DailyLimitExceededError(24);
  }
};

interface InitiateWithdrawalInput {
  userId: string;
  accountId: string;
  amount: Decimal.Value;
  note?: string;
}

export const initiateWithdrawal = async (input: InitiateWithdrawalInput) => {
  const amount = parseAmount(input.amount, 'amount');
  if (amount.lte(0)) {
    throw createHttpError(400, 'Amount must be greater than 0');
  }

  const account = await prisma.withdrawalAccount.findFirst({
    where: {
      id: input.accountId,
      userId: input.userId,
      deletedAt: null,
    },
  });

  if (!account) {
    throw createHttpError(404, 'Withdrawal account not found');
  }

  const rail = getPaymentRail(account.countryCode as CountryCode);
  if (!rail || !rail.methods.includes(account.method)) {
    throw createHttpError(400, 'Method not available in your region');
  }

  const limit = rail.limits[account.method];
  if (amount.lt(limit.min)) {
    throw createHttpError(400, `Minimum withdrawal is ${limit.min} ${rail.currency}`);
  }
  if (amount.gt(limit.max)) {
    throw createHttpError(400, `Maximum withdrawal is ${limit.max} ${rail.currency}`);
  }

  await checkDailyLimit(input.userId, amount, rail.currency);

  const created = await prisma.$transaction(
    async (tx) => {
      const accountInTx = await tx.withdrawalAccount.findFirst({
        where: {
          id: input.accountId,
          userId: input.userId,
          deletedAt: null,
        },
      });
      if (!accountInTx) {
        throw createHttpError(404, 'Withdrawal account not found');
      }

      const wallet = await getOrCreateWallet(input.userId, tx);
      await lockWalletRow(wallet.id, tx);
      const currentWallet = await tx.wallet.findUniqueOrThrow({
        where: { id: wallet.id },
      });
      if (currentWallet.status === 'frozen') {
        throw createHttpError(403, 'Wallet is frozen');
      }
      if (currentWallet.status !== 'active') {
        throw createHttpError(403, 'Wallet is not active');
      }

      const walletBalance = new Decimal(currentWallet.balance.toString());
      const reserved = new Decimal(currentWallet.reservedBalance.toString());
      const available = walletBalance.sub(reserved);
      if (available.lt(amount)) {
        throw new InsufficientBalanceError('Insufficient balance');
      }

      const fee = getWithdrawalFee(accountInTx.method, amount, currentWallet.currency);
      const netAmount = amount.sub(fee.feeAmount);
      if (netAmount.lte(0)) {
        throw createHttpError(400, 'Net withdrawal amount must be greater than zero');
      }

      const title = generateTitle('debit', 'withdrawal_initiated', {
        displayName: accountInTx.displayName,
      });
      const debitResult = await debitWallet(
        {
          userId: input.userId,
          amount,
          reason: 'withdrawal_initiated',
          title,
          description: input.note?.trim() || `Withdrawal to ${accountInTx.displayName}`,
          referenceType: 'withdrawal',
          referenceId: `init:${accountInTx.id}:${Date.now()}`,
          metadata: {
            accountId: accountInTx.id,
            method: accountInTx.method,
          },
        },
        tx,
      );

      const withdrawal = await tx.withdrawal.create({
        data: {
          userId: input.userId,
          walletId: currentWallet.id,
          accountId: accountInTx.id,
          amount: toDecimalString(amount),
          currency: currentWallet.currency,
          feeAmount: toDecimalString(fee.feeAmount),
          netAmount: toDecimalString(netAmount),
          status: 'pending',
          method: accountInTx.method,
          countryCode: accountInTx.countryCode,
          providerName: accountInTx.providerName || 'mock',
          isMocked: true,
          estimatedArrival: methodEstimatedTime[accountInTx.method] ?? 'Within 1-3 business days',
          walletTransactionId: debitResult.walletTransaction.id,
        },
        include: {
          account: {
            select: { displayName: true },
          },
        },
      });

      await tx.walletTransaction.update({
        where: {
          id: debitResult.walletTransaction.id,
        },
        data: {
          referenceId: withdrawal.id,
        },
      });

      return {
        withdrawal,
        walletBalanceAfter: debitResult.wallet.balance.toString(),
      };
    },
    {
      maxWait: 10000, // 10 seconds max wait time
      timeout: 15000, // 15 seconds timeout
    },
  );

  void processWithdrawal(created.withdrawal.id).catch((error) => {
    logger.error('Failed to process withdrawal asynchronously', {
      withdrawalId: created.withdrawal.id,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return {
    ...serializeWithdrawal(created.withdrawal),
    withdrawalId: created.withdrawal.id,
    walletBalanceAfter: created.walletBalanceAfter,
  };
};

export const processWithdrawal = async (withdrawalId: string) => {
  const withdrawal = await prisma.withdrawal.findUnique({
    where: { id: withdrawalId },
    include: {
      account: true,
    },
  });

  if (!withdrawal || withdrawal.status !== 'pending') {
    return null;
  }
  if (!withdrawal.account) {
    await prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: 'failed',
        failureReason: 'Withdrawal account is missing for internal payout',
      },
    });
    return null;
  }

  const provider = getProvider(withdrawal.providerName);

  try {
    const response = await provider.submitPayout({
      amount: new Decimal(withdrawal.netAmount.toString()),
      currency: withdrawal.currency,
      method: withdrawal.method,
      encryptedAccountDetails: withdrawal.account.encryptedDetails,
      withdrawalId: withdrawal.id,
    });

    return prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: 'processing',
        providerReference: response.providerReference,
        mockCompletesAt: response.mockCompletesAt,
        estimatedArrival: response.estimatedArrival,
        providerResponse: {
          stage: 'submit',
          providerReference: response.providerReference,
          estimatedArrival: response.estimatedArrival,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (error instanceof MockProviderError) {
      await prisma.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: 'failed',
          failureReason: error.message,
          providerResponse: {
            stage: 'submit',
            error: error.message,
          } as Prisma.InputJsonValue,
        },
      });
      await refundWithdrawal(withdrawal.id);
      return null;
    }

    throw error;
  }
};

export const refundWithdrawal = async (withdrawalId: string) => {
  return prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: {
        account: {
          select: {
            displayName: true,
          },
        },
      },
    });
    if (!withdrawal) {
      throw createHttpError(404, 'Withdrawal not found');
    }
    if (withdrawal.status === 'refunded') {
      return withdrawal;
    }

    await creditWallet(
      {
        userId: withdrawal.userId,
        amount: withdrawal.amount.toString(),
        reason: 'withdrawal_refunded',
        title: 'Withdrawal refunded',
        description: `Refund for withdrawal ${withdrawal.id}`,
        referenceType: 'withdrawal',
        referenceId: withdrawal.id,
        metadata: {
          method: withdrawal.method,
          status: withdrawal.status,
        },
      },
      tx,
    );

    return tx.withdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: 'refunded',
      },
      include: {
        account: {
          select: { displayName: true },
        },
      },
    });
  });
};

export const cancelWithdrawal = async (userId: string, withdrawalId: string) => {
  return prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawal.findFirst({
      where: {
        id: withdrawalId,
        userId,
      },
      include: {
        account: {
          select: {
            displayName: true,
          },
        },
      },
    });
    if (!withdrawal) {
      throw createHttpError(404, 'Withdrawal not found');
    }
    if (withdrawal.status !== 'pending') {
      throw createHttpError(400, `Cannot cancel a ${withdrawal.status} withdrawal`);
    }

    const creditResult = await creditWallet(
      {
        userId,
        amount: withdrawal.amount.toString(),
        reason: 'withdrawal_refunded',
        title: 'Withdrawal cancelled',
        description: `Cancelled withdrawal ${withdrawal.id}`,
        referenceType: 'withdrawal',
        referenceId: `${withdrawal.id}:cancel`,
      },
      tx,
    );

    const updated = await tx.withdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: 'cancelled',
      },
      include: {
        account: {
          select: { displayName: true },
        },
      },
    });

    return {
      withdrawal: serializeWithdrawal(updated),
      walletBalanceAfter: creditResult.wallet.balance.toString(),
    };
  });
};

interface ListWithdrawalsInput {
  userId: string;
  page: number;
  limit: number;
  status?: WithdrawalStatus;
}

export const listWithdrawals = async (input: ListWithdrawalsInput) => {
  const where: Prisma.WithdrawalWhereInput = {
    userId: input.userId,
    ...(input.status ? { status: input.status } : {}),
  };
  const [total, data] = await Promise.all([
    prisma.withdrawal.count({ where }),
    prisma.withdrawal.findMany({
      where,
      include: {
        account: {
          select: { displayName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
  ]);

  return {
    data: data.map(serializeWithdrawal),
    total,
    page: input.page,
    limit: input.limit,
    totalPages: Math.max(1, Math.ceil(total / input.limit)),
  };
};

export const getWithdrawalById = async (userId: string, withdrawalId: string) => {
  const withdrawal = await prisma.withdrawal.findFirst({
    where: {
      id: withdrawalId,
      userId,
    },
    include: {
      account: {
        select: { displayName: true },
      },
    },
  });
  if (!withdrawal) {
    throw createHttpError(404, 'Withdrawal not found');
  }
  return serializeWithdrawal(withdrawal);
};
