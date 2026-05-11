import createHttpError from 'http-errors';
import Decimal from 'decimal.js';
import env from '../config/dotenv.config';
import prisma from '../config/prisma.config';
import { generateTitle } from '../utils/transactionTitle';
import { getEntriesForWallet, recordEntry, type LedgerWalletFilters } from './ledger.service';
import { sendPaymentReceivedNotification } from './notification.service';
import { pushNotificationService } from './push-notification.service';
import { Prisma } from '../generated/prisma/client';
import type {
  Wallet,
  WalletEntryReason,
  WalletStatus,
  WalletTransaction,
  WalletTransactionType,
} from '../generated/prisma/client';
import logger from '../config/logger.config';

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type WalletClientLike = Pick<TxClient, 'wallet'>;

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  String((error as { code?: unknown }).code) === 'P2002';

const lockWalletRow = async (walletId: string, tx: TxClient) => {
  await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${walletId} FOR UPDATE`;
};

const parseDecimal = (value: Decimal.Value) => new Decimal(value);

const getPlatformWallet = async (tx: TxClient) => {
  // Ensure platform user exists - create if needed
  await tx.user.upsert({
    where: { id: env.PLATFORM_USER_ID },
    create: {
      id: env.PLATFORM_USER_ID,
      username: 'ADMIN',
      phoneNumber: '+00000000000',
      name: 'Platform Admin',
    },
    update: {},
  });

  return getOrCreateWallet(env.PLATFORM_USER_ID, tx);
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
  cryptoType: string;
  cryptoAmount: Decimal.Value;
  platformFeeAmount: Decimal.Value;
  platformFeeCrypto: Decimal.Value;
  totalCryptoAmount: Decimal.Value;
  senderCurrency: string;
  senderCurrencyAmount: Decimal.Value;
  receiverCurrency: string;
  receiverCurrencyAmount: Decimal.Value;
  cryptoToSenderRate: Decimal.Value;
  senderToReceiverRate: Decimal.Value;
  platformFeePercent: Decimal.Value;
  rateSource: string;
  rateSnapshotAt: Date;
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
  console.log('RECEIVERS:', existing);
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
  logger.info('💰 Starting convertAndCredit', {
    paymentId: payment.id,
    recipientUserId,
    cryptoType: payment.cryptoType,
    cryptoAmount: String(payment.cryptoAmount),
    receiverCurrencyAmount: String(payment.receiverCurrencyAmount),
    receiverCurrency: payment.receiverCurrency,
  });

  console.log('========== recipient user id:', recipientUserId);
  const recipientWallet = await getOrCreateWallet(recipientUserId, tx);
  logger.info('✅ Recipient wallet retrieved', {
    paymentId: payment.id,
    walletId: recipientWallet.id,
    currency: recipientWallet.currency,
  });

  const localAmount = parseDecimal(payment.receiverCurrencyAmount);
  const feeInReceiverCurrency = parseDecimal(payment.platformFeeAmount).mul(
    parseDecimal(payment.senderToReceiverRate),
  );

  console.log('========== SENDER ID:', payment.senderId);

  const sender = await tx.user.findUnique({
    where: { id: payment.senderId },
    select: { username: true, name: true },
  });

  const recipient = await tx.user.findUnique({
    where: { id: recipientUserId },
    select: { phoneNumber: true },
  });

  const senderUsername = sender?.username ?? 'unknown';
  const senderName = sender?.name ?? senderUsername;

  logger.info('👥 Sender and recipient info retrieved', {
    paymentId: payment.id,
    senderUsername,
    senderName,
    recipientPhone: recipient?.phoneNumber ? 'present' : 'missing',
  });

  const title = generateTitle('credit', 'payment_received', {
    localAmount,
    currency: recipientWallet.currency,
    cryptoAmount: payment.cryptoAmount,
    token: payment.cryptoType,
  });

  logger.info('💳 Crediting recipient wallet', {
    paymentId: payment.id,
    recipientUserId,
    amount: localAmount.toString(),
    currency: recipientWallet.currency,
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
        cryptoType: payment.cryptoType,
        cryptoAmount: String(payment.cryptoAmount),
        platformFeeAmount: String(payment.platformFeeAmount),
        platformFeeCrypto: String(payment.platformFeeCrypto),
        totalCryptoAmount: String(payment.totalCryptoAmount),
        senderCurrency: payment.senderCurrency,
        senderCurrencyAmount: String(payment.senderCurrencyAmount),
        receiverCurrency: payment.receiverCurrency,
        receiverCurrencyAmount: String(payment.receiverCurrencyAmount),
        cryptoToSenderRate: String(payment.cryptoToSenderRate),
        senderToReceiverRate: String(payment.senderToReceiverRate),
        platformFeePercent: String(payment.platformFeePercent),
        rateSource: payment.rateSource,
        rateSnapshotAt: payment.rateSnapshotAt.toISOString(),
        senderPublicKey: payment.senderPublicKey,
      },
    },
    tx,
  );

  logger.info('✅ Recipient wallet credited successfully', {
    paymentId: payment.id,
    recipientUserId,
  });

  const platformWallet = await getPlatformWallet(tx);
  await recordEntry(
    {
      debitWalletId: platformWallet.id,
      creditWalletId: platformWallet.id,
      amount: feeInReceiverCurrency,
      currency: payment.receiverCurrency,
      reason: 'fee_charged',
      referenceType: 'payment',
      referenceId: payment.id,
      note: `Platform fee ${payment.platformFeePercent}% = ${payment.platformFeeAmount} ${payment.senderCurrency} (${payment.platformFeeCrypto} ${payment.cryptoType})`,
      allowSameWalletEntry: true,
    },
    tx,
  );

  logger.info('💰 Platform fee recorded', {
    paymentId: payment.id,
    feeAmount: feeInReceiverCurrency.toString(),
    currency: payment.receiverCurrency,
  });

  // Send payment notification to recipient
  if (recipient?.phoneNumber) {
    logger.info('📱 Scheduling SMS notification to recipient', {
      paymentId: payment.id,
      recipientPhone: recipient.phoneNumber.substring(0, 5) + '***',
    });

    // Send SMS notification asynchronously without blocking the transaction
    setImmediate(() => {
      sendPaymentReceivedNotification({
        recipientPhone: recipient.phoneNumber,
        senderName,
        amount: localAmount.toFixed(2),
        currency: payment.receiverCurrency,
        cryptoAmount: String(payment.cryptoAmount),
        cryptoType: payment.cryptoType,
      });
    });
  } else {
    logger.warn('⚠️ No phone number for recipient, skipping SMS', {
      paymentId: payment.id,
      recipientUserId,
    });
  }

  // Send push notification to recipient
  logger.info('🔔 Scheduling push notification to recipient', {
    paymentId: payment.id,
    recipientUserId,
  });

  setImmediate(() => {
    pushNotificationService
      .sendPaymentReceivedNotification({
        userId: recipientUserId,
        senderName,
        amount: localAmount.toFixed(2),
        currency: payment.receiverCurrency,
        paymentId: payment.id,
      })
      .catch((error) => {
        logger.error('❌ Failed to send push notification to recipient', {
          paymentId: payment.id,
          recipientUserId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  });

  // Send push notification to sender
  logger.info('🔔 Scheduling push notification to sender', {
    paymentId: payment.id,
    senderId: payment.senderId,
  });

  setImmediate(() => {
    pushNotificationService
      .sendPaymentSentNotification({
        userId: payment.senderId,
        recipientName: payment.recipientUsername,
        amount: localAmount.toFixed(2),
        currency: payment.receiverCurrency,
        paymentId: payment.id,
      })
      .catch((error) => {
        logger.error('❌ Failed to send push notification to sender', {
          paymentId: payment.id,
          senderId: payment.senderId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  });

  logger.info('✅ convertAndCredit completed successfully', {
    paymentId: payment.id,
    recipientUserId,
  });
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
