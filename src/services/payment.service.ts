import createHttpError from 'http-errors';
import Decimal from 'decimal.js';
import { Currency, PaymentStatus } from '../generated/prisma/client';
import logger from '../config/logger.config';
import prisma from '../config/prisma.config';
import env from '../config/dotenv.config';
import { PublicKey } from '@solana/web3.js';
import {
  buildFeeBreakdown,
  calculateAmounts,
  estimateNetworkFee,
  type FeeBreakdown,
} from './fee.service';
import { buildPaymentTransaction } from './transaction.service';

export interface CreatePaymentInput {
  userId: string;
  recipientUsername: string;
  amount: string;
  currency: Currency;
}

const ensureValidPublicKey = (value: string): string => {
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw createHttpError(400, 'Sender wallet is not configured correctly.');
  }
};

const toClientPayment = (payment: {
  id: string;
  senderId: string;
  recipientUsername: string;
  recipientUserId: string;
  amount: unknown;
  totalAmount: unknown;
  currency: Currency;
  senderPublicKey: string;
  status: PaymentStatus;
  txHash: string | null;
  feeBreakdown: unknown;
  createdAt: Date;
  expiresAt: Date;
  completedAt: Date | null;
  failureReason: string | null;
}) => {
  const amountStr = payment.amount ? String(payment.amount) : '0';
  const totalAmountStr = payment.totalAmount ? String(payment.totalAmount) : null;

  let feeBreakdown = payment.feeBreakdown;
  if (feeBreakdown && typeof feeBreakdown === 'object') {
    const copy = { ...(feeBreakdown as Record<string, unknown>) };
    for (const key of ['baseAmount', 'networkFee', 'serviceFee', 'totalAmount']) {
      if (copy[key] !== undefined && copy[key] !== null) {
        copy[key] = String(copy[key]);
      }
    }
    feeBreakdown = copy;
  }

  return {
    ...payment,
    amount: amountStr,
    totalAmount: totalAmountStr,
    feeBreakdown,
  };
};

export const createPayment = async (input: CreatePaymentInput) => {
  const amount = new Decimal(input.amount);
  if (!amount.isFinite() || amount.lte(0)) {
    throw createHttpError(400, 'Amount must be greater than 0.');
  }

  const sender = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, username: true, solanaPublicKey: true },
  });
  if (!sender) {
    throw createHttpError(404, 'Sender not found.');
  }

  const recipient = await prisma.user.findUnique({
    where: { username: input.recipientUsername },
    select: { id: true, username: true },
  });
  if (!recipient) {
    throw createHttpError(404, 'Recipient not found.');
  }
  if (recipient.id === sender.id || recipient.username === sender.username) {
    throw createHttpError(400, 'Sender and recipient cannot be the same user.');
  }
  if (!sender.solanaPublicKey) {
    throw createHttpError(400, 'Please set your wallet first.');
  }

  const senderPublicKey = ensureValidPublicKey(sender.solanaPublicKey);
  const computed = calculateAmounts(input.amount, input.currency);
  const expiresAt = new Date(Date.now() + env.TX_EXPIRY_MINUTES * 60_000);

  const payment = await prisma.payment.create({
    data: {
      senderId: sender.id,
      recipientUsername: recipient.username,
      recipientUserId: recipient.id,
      amount: computed.baseAmount,
      currency: input.currency,
      senderPublicKey,
      totalAmount: computed.totalAmount,
      status: PaymentStatus.pending,
      expiresAt,
      feeBreakdown: {
        baseAmount: computed.baseAmount,
        serviceFee: computed.serviceFee,
        totalAmount: computed.totalAmount,
        networkFee: '0',
        networkFeeCurrency: 'SOL',
        currency: input.currency,
      },
    },
  });

  const built = await buildPaymentTransaction({
    paymentId: payment.id,
    senderPublicKey,
    currency: input.currency,
    totalAmount: computed.totalAmount,
  });
  const networkFee = await estimateNetworkFee(built.transaction);
  const feeBreakdown: FeeBreakdown = buildFeeBreakdown({
    amount: input.amount,
    currency: input.currency,
    networkFee,
  });

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: { feeBreakdown },
  });

  logger.info('Payment created', {
    paymentId: payment.id,
    userId: sender.id,
    oldStatus: null,
    newStatus: PaymentStatus.pending,
  });

  return {
    paymentId: updated.id,
    recipientUsername: updated.recipientUsername,
    feeBreakdown,
    transaction: built.transactionBase64,
    expiresAt: updated.expiresAt.toISOString(),
  };
};

export const getPaymentById = async (id: string) => {
  const payment = await prisma.payment.findUnique({ where: { id } });
  if (!payment) {
    throw createHttpError(404, 'Payment not found.');
  }
  return toClientPayment(payment);
};

export const cancelPayment = async (paymentId: string, userId: string) => {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw createHttpError(404, 'Payment not found.');
  if (payment.senderId !== userId) throw createHttpError(403, 'Forbidden');
  if (payment.status !== PaymentStatus.pending) {
    throw createHttpError(400, 'Only pending payments can be cancelled.');
  }

  const updated = await prisma.payment.update({
    where: { id: paymentId },
    data: { status: PaymentStatus.cancelled },
  });

  logger.info('Payment status changed', {
    paymentId: paymentId,
    userId,
    oldStatus: payment.status,
    newStatus: PaymentStatus.cancelled,
  });

  return toClientPayment(updated);
};

export const paymentHistory = async (params: {
  userId: string;
  page: number;
  limit: number;
  status?: PaymentStatus;
}) => {
  const where = {
    senderId: params.userId,
    ...(params.status ? { status: params.status } : {}),
  };

  const [total, data] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
  ]);

  return {
    data: data.map(toClientPayment),
    total,
    page: params.page,
    limit: params.limit,
    totalPages: Math.max(1, Math.ceil(total / params.limit)),
  };
};

export const updateUserWallet = async (userId: string, solanaPublicKey: string) => {
  const normalized = ensureValidPublicKey(solanaPublicKey);
  const user = await prisma.user.update({
    where: { id: userId },
    data: { solanaPublicKey: normalized },
    select: { id: true, username: true, solanaPublicKey: true },
  });
  return user;
};
