import createHttpError from 'http-errors';
import Decimal from 'decimal.js';
import env from '../config/dotenv.config';
import prisma from '../config/prisma.config';
import { withRetry } from '../utils/backoff';
import { generateTitle } from '../utils/transactionTitle';
import { getEntriesForWallet, recordEntry, type LedgerWalletFilters } from './ledger.service';
import { Prisma } from '../generated/prisma/client';
import type {
  Currency,
  Wallet,
  WalletEntryReason,
  WalletStatus,
  WalletTransaction,
  WalletTransactionType,
} from '../generated/prisma/client';

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type WalletClientLike = Pick<TxClient, 'wallet'>;

const RATE_CACHE = new Map<
  string,
  { rate: string; source: 'jupiter' | 'coingecko'; updatedAt: Date }
>();

const COINGECKO_IDS: Record<Currency, string> = {
  SOL: 'solana',
  USDT: 'tether',
  USDC: 'usd-coin',
  LINK: 'chainlink',
};

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  String((error as { code?: unknown }).code) === 'P2002';

const lockWalletRow = async (walletId: string, tx: TxClient) => {
  await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${walletId} FOR UPDATE`;
};

const parseDecimal = (value: Decimal.Value) => new Decimal(value);

const getPlatformWallet = async (tx: TxClient) => getOrCreateWallet(env.PLATFORM_USER_ID, tx);

const normalizeFeeBreakdown = (feeBreakdown: unknown) => {
  const payload =
    feeBreakdown && typeof feeBreakdown === 'object'
      ? (feeBreakdown as Record<string, unknown>)
      : {};
  return {
    baseCryptoAmount: String(payload.baseCryptoAmount ?? payload.baseAmount ?? '0'),
    feeCryptoAmount: String(payload.feeCryptoAmount ?? payload.serviceFee ?? '0'),
    totalCryptoAmount: String(payload.totalCryptoAmount ?? payload.totalAmount ?? '0'),
    feePercent: String(payload.feePercent ?? env.SERVICE_FEE_PERCENT),
    feeUsd: String(payload.feeUsd ?? '0'),
  };
};

const getRateCacheKey = (cryptoCurrency: Currency, fiatCurrency: string) =>
  `${cryptoCurrency}:${fiatCurrency.toUpperCase()}`;

const fetchJupiterUsdRate = async (cryptoCurrency: Currency): Promise<Decimal> => {
  const url = `https://price.jup.ag/v4/price?ids=${cryptoCurrency}&vsToken=USDC`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Jupiter rate fetch failed with status ${response.status}`);
  }
  const json = (await response.json()) as {
    data?: Record<string, { price?: number | string }>;
  };
  const raw = json.data?.[cryptoCurrency]?.price;
  if (raw === undefined || raw === null) {
    throw new Error('Jupiter response missing price');
  }
  return parseDecimal(String(raw));
};

const fetchCoingeckoRate = async (
  cryptoCurrency: Currency,
  fiatCurrency: string,
): Promise<Decimal> => {
  const coinId = COINGECKO_IDS[cryptoCurrency];
  const vsCurrency = fiatCurrency.toLowerCase();
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=${vsCurrency}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`CoinGecko rate fetch failed with status ${response.status}`);
  }
  const json = (await response.json()) as Record<string, Record<string, number | string>>;
  const raw = json[coinId]?.[vsCurrency];
  if (raw === undefined || raw === null) {
    throw new Error('CoinGecko response missing rate');
  }
  return parseDecimal(String(raw));
};

const getExchangeRate = async (
  cryptoCurrency: Currency,
  fiatCurrency: string,
): Promise<{ exchangeRate: Decimal; rateSource: 'jupiter' | 'coingecko' | 'cache' }> => {
  const normalizedFiat = fiatCurrency.toUpperCase();
  const key = getRateCacheKey(cryptoCurrency, normalizedFiat);

  const cached = RATE_CACHE.get(key);

  try {
    if (normalizedFiat === 'USD') {
      const jupiterRate = await withRetry(() => fetchJupiterUsdRate(cryptoCurrency));
      RATE_CACHE.set(key, {
        rate: jupiterRate.toString(),
        source: 'jupiter',
        updatedAt: new Date(),
      });
      return { exchangeRate: jupiterRate, rateSource: 'jupiter' };
    }

    await withRetry(() => fetchJupiterUsdRate(cryptoCurrency));
    const coingeckoRate = await withRetry(() => fetchCoingeckoRate(cryptoCurrency, normalizedFiat));
    RATE_CACHE.set(key, {
      rate: coingeckoRate.toString(),
      source: 'coingecko',
      updatedAt: new Date(),
    });
    return { exchangeRate: coingeckoRate, rateSource: 'coingecko' };
  } catch (error) {
    if (cached) {
      return { exchangeRate: parseDecimal(cached.rate), rateSource: 'cache' };
    }
    throw error;
  }
};

export class InsufficientBalanceError extends Error {
  constructor(message = 'Insufficient available balance.') {
    super(message);
    this.name = 'InsufficientBalanceError';
  }
}

export interface WalletBalanceSnapshot {
  balance: Decimal;
  reservedBalance: Decimal;
  available: Decimal;
  currency: string;
  status: WalletStatus;
}

interface WalletMutationParams {
  userId: string;
  amount: Decimal.Value;
  reason: WalletEntryReason;
  title: string;
  description?: string;
  referenceType?: string;
  referenceId?: string;
  counterpartyId?: string;
  counterpartyUsername?: string;
  counterpartyName?: string;
  metadata?: Prisma.JsonValue;
}

interface ConvertAndCreditPaymentInput {
  id: string;
  amount: Decimal.Value;
  currency: Currency;
  feeBreakdown?: unknown;
  senderId: string;
  senderPublicKey: string;
  recipientUsername: string;
}

interface WalletTransactionFilters {
  page: number;
  limit: number;
  type?: WalletTransactionType;
  reason?: WalletEntryReason;
  from?: Date;
  to?: Date;
}

const toStringAmount = (value: Decimal.Value) => parseDecimal(value).toString();
const toPrismaMetadata = (
  metadata?: Prisma.JsonValue,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined => {
  if (metadata === undefined) return undefined;
  if (metadata === null) return Prisma.JsonNull;
  return metadata as Prisma.InputJsonValue;
};

const ensureWalletActive = (wallet: Wallet) => {
  if (wallet.status !== 'active') {
    throw createHttpError(403, 'Wallet is not active.');
  }
};

export const getOrCreateWallet = async (
  userId: string,
  prismaClient: WalletClientLike = prisma as unknown as WalletClientLike,
) => {
  const existing = await prismaClient.wallet.findUnique({ where: { userId } });
  if (existing) return existing;

  try {
    return await prismaClient.wallet.create({
      data: {
        userId,
        balance: '0',
        reservedBalance: '0',
        status: 'active',
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const createdByRace = await prismaClient.wallet.findUnique({ where: { userId } });
    if (!createdByRace) throw error;
    return createdByRace;
  }
};

export const getBalance = async (userId: string): Promise<WalletBalanceSnapshot> => {
  const wallet = await getOrCreateWallet(userId);
  const balance = parseDecimal(wallet.balance.toString());
  const reservedBalance = parseDecimal(wallet.reservedBalance.toString());

  return {
    balance,
    reservedBalance,
    available: balance.sub(reservedBalance),
    currency: wallet.currency,
    status: wallet.status,
  };
};

const findExistingByReference = async (
  walletId: string,
  type: WalletTransactionType,
  reason: WalletEntryReason,
  tx: TxClient,
  referenceType?: string,
  referenceId?: string,
) => {
  if (!referenceType || !referenceId) return null;

  return tx.walletTransaction.findFirst({
    where: {
      walletId,
      type,
      reason,
      referenceType,
      referenceId,
    },
    orderBy: { createdAt: 'desc' },
  });
};

export const creditWallet = async (params: WalletMutationParams, tx: TxClient) => {
  const recipientWallet = await getOrCreateWallet(params.userId, tx);
  await lockWalletRow(recipientWallet.id, tx);
  const platformWallet = await getPlatformWallet(tx);

  const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: recipientWallet.id } });
  ensureWalletActive(wallet);

  const existing = await findExistingByReference(
    wallet.id,
    'credit',
    params.reason,
    tx,
    params.referenceType,
    params.referenceId,
  );
  if (existing) {
    return { wallet, walletTransaction: existing };
  }

  const amount = parseDecimal(params.amount);
  if (amount.lte(0)) {
    throw createHttpError(400, 'Amount must be greater than 0.');
  }

  const balanceBefore = parseDecimal(wallet.balance.toString());
  const balanceAfter = balanceBefore.add(amount);

  const updatedWallet = await tx.wallet.update({
    where: { id: wallet.id },
    data: { balance: toStringAmount(balanceAfter) },
  });

  const walletTransaction = await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: 'credit',
      amount: toStringAmount(amount),
      balanceBefore: toStringAmount(balanceBefore),
      balanceAfter: toStringAmount(balanceAfter),
      status: 'completed',
      reason: params.reason,
      title: params.title,
      description: params.description,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      counterpartyId: params.counterpartyId,
      counterpartyUsername: params.counterpartyUsername,
      counterpartyName: params.counterpartyName,
      metadata: toPrismaMetadata(params.metadata),
    },
  });

  await recordEntry(
    {
      debitWalletId: platformWallet.id,
      creditWalletId: wallet.id,
      amount,
      currency: wallet.currency,
      reason: params.reason,
      walletTransactionId: walletTransaction.id,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      note: params.description,
    },
    tx,
  );

  return { wallet: updatedWallet, walletTransaction };
};

export const debitWallet = async (params: WalletMutationParams, tx: TxClient) => {
  const userWallet = await getOrCreateWallet(params.userId, tx);
  await lockWalletRow(userWallet.id, tx);
  const platformWallet = await getPlatformWallet(tx);

  const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: userWallet.id } });
  ensureWalletActive(wallet);

  const existing = await findExistingByReference(
    wallet.id,
    'debit',
    params.reason,
    tx,
    params.referenceType,
    params.referenceId,
  );
  if (existing) {
    return { wallet, walletTransaction: existing };
  }

  const amount = parseDecimal(params.amount);
  if (amount.lte(0)) {
    throw createHttpError(400, 'Amount must be greater than 0.');
  }

  const balanceBefore = parseDecimal(wallet.balance.toString());
  if (balanceBefore.lt(amount)) {
    throw new InsufficientBalanceError();
  }
  const balanceAfter = balanceBefore.sub(amount);

  const updatedWallet = await tx.wallet.update({
    where: { id: wallet.id },
    data: { balance: toStringAmount(balanceAfter) },
  });

  const walletTransaction = await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: 'debit',
      amount: toStringAmount(amount),
      balanceBefore: toStringAmount(balanceBefore),
      balanceAfter: toStringAmount(balanceAfter),
      status: 'completed',
      reason: params.reason,
      title: params.title,
      description: params.description,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      counterpartyId: params.counterpartyId,
      counterpartyUsername: params.counterpartyUsername,
      counterpartyName: params.counterpartyName,
      metadata: toPrismaMetadata(params.metadata),
    },
  });

  await recordEntry(
    {
      debitWalletId: wallet.id,
      creditWalletId: platformWallet.id,
      amount,
      currency: wallet.currency,
      reason: params.reason,
      walletTransactionId: walletTransaction.id,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      note: params.description,
    },
    tx,
  );

  return { wallet: updatedWallet, walletTransaction };
};

export const reserveBalance = async (userId: string, amount: Decimal.Value, tx: TxClient) => {
  const wallet = await getOrCreateWallet(userId, tx);
  await lockWalletRow(wallet.id, tx);
  const current = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
  ensureWalletActive(current);

  const value = parseDecimal(amount);
  if (value.lte(0)) throw createHttpError(400, 'Reservation amount must be greater than 0.');

  const balance = parseDecimal(current.balance.toString());
  const reserved = parseDecimal(current.reservedBalance.toString());
  const available = balance.sub(reserved);
  if (available.lt(value)) throw new InsufficientBalanceError();

  return tx.wallet.update({
    where: { id: current.id },
    data: { reservedBalance: toStringAmount(reserved.add(value)) },
  });
};

export const releaseReservation = async (userId: string, amount: Decimal.Value, tx: TxClient) => {
  const wallet = await getOrCreateWallet(userId, tx);
  await lockWalletRow(wallet.id, tx);
  const current = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });

  const value = parseDecimal(amount);
  if (value.lte(0)) throw createHttpError(400, 'Release amount must be greater than 0.');

  const reserved = parseDecimal(current.reservedBalance.toString());
  const updated = Decimal.max(new Decimal(0), reserved.sub(value));

  return tx.wallet.update({
    where: { id: current.id },
    data: { reservedBalance: toStringAmount(updated) },
  });
};

export const convertAndCredit = async (
  recipientUserId: string,
  payment: ConvertAndCreditPaymentInput,
  tx: TxClient,
): Promise<void> => {
  const recipientWallet = await getOrCreateWallet(recipientUserId, tx);
  const { exchangeRate, rateSource } = await getExchangeRate(
    payment.currency,
    recipientWallet.currency,
  );
  const feeBreakdown = normalizeFeeBreakdown(payment.feeBreakdown);

  const baseCryptoAmount = parseDecimal(payment.amount);
  const feeCryptoAmount = parseDecimal(feeBreakdown.feeCryptoAmount);
  const localAmount = baseCryptoAmount.mul(exchangeRate);
  const feeLocalAmount = feeCryptoAmount.mul(exchangeRate);

  const sender = await tx.user.findUnique({
    where: { id: payment.senderId },
    select: { username: true, name: true },
  });

  const senderUsername = sender?.username ?? 'unknown';
  const senderName = sender?.name ?? senderUsername;

  const title = generateTitle('credit', 'payment_received', {
    localAmount,
    currency: recipientWallet.currency,
    cryptoAmount: baseCryptoAmount,
    token: payment.currency,
  });

  await creditWallet(
    {
      userId: recipientUserId,
      amount: localAmount,
      reason: 'payment_received',
      title,
      description: `Payment from @${senderUsername}`,
      referenceType: 'payment',
      referenceId: payment.id,
      counterpartyId: payment.senderId,
      counterpartyUsername: senderUsername,
      counterpartyName: senderName,
      metadata: {
        baseCryptoAmount: baseCryptoAmount.toString(),
        feeCryptoAmount: feeCryptoAmount.toString(),
        totalCryptoAmount: feeBreakdown.totalCryptoAmount,
        feePercent: feeBreakdown.feePercent,
        feeLocalAmount: feeLocalAmount.toFixed(2),
        localAmount: localAmount.toFixed(2),
        exchangeRate: exchangeRate.toString(),
        rateSource,
        currency: recipientWallet.currency,
        token: payment.currency,
        senderPublicKey: payment.senderPublicKey,
      },
    },
    tx,
  );

  const platformWallet = await getPlatformWallet(tx);
  await recordEntry(
    {
      debitWalletId: platformWallet.id,
      creditWalletId: platformWallet.id,
      amount: feeLocalAmount,
      currency: recipientWallet.currency,
      reason: 'fee_charged',
      referenceType: 'payment',
      referenceId: payment.id,
      note: `Platform fee ${feeBreakdown.feePercent}% on payment ${payment.id}`,
      allowSameWalletEntry: true,
    },
    tx,
  );
};

const serializeTransaction = (txRecord: WalletTransaction) => ({
  ...txRecord,
  amount: txRecord.amount.toString(),
  balanceBefore: txRecord.balanceBefore.toString(),
  balanceAfter: txRecord.balanceAfter.toString(),
});

export const listWalletTransactions = async (userId: string, filters: WalletTransactionFilters) => {
  const wallet = await getOrCreateWallet(userId);
  const where: Prisma.WalletTransactionWhereInput = {
    walletId: wallet.id,
    ...(filters.type ? { type: filters.type } : {}),
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

  const [total, transactions] = await Promise.all([
    prisma.walletTransaction.count({ where }),
    prisma.walletTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
  ]);

  return {
    data: transactions.map(serializeTransaction),
    total,
    page: filters.page,
    limit: filters.limit,
    totalPages: Math.max(1, Math.ceil(total / filters.limit)),
  };
};

export const getWalletTransactionById = async (userId: string, transactionId: string) => {
  const wallet = await getOrCreateWallet(userId);
  const txRecord = await prisma.walletTransaction.findFirst({
    where: {
      id: transactionId,
      walletId: wallet.id,
    },
  });

  if (!txRecord) {
    throw createHttpError(404, 'Wallet transaction not found.');
  }

  return serializeTransaction(txRecord);
};

export const getLedgerEntriesForWallet = async (walletId: string, filters: LedgerWalletFilters) =>
  getEntriesForWallet(walletId, filters);
