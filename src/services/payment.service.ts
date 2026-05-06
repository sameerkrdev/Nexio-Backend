import createHttpError from 'http-errors';
import Decimal from 'decimal.js';
import { PaymentStatus } from '../generated/prisma/client';
import logger from '../config/logger.config';
import prisma from '../config/prisma.config';
import env from '../config/dotenv.config';
import { PublicKey } from '@solana/web3.js';
import { buildPaymentTransaction } from './transaction.service';
import { fetchCryptoRate, fetchFiatRate } from './quote.service';
import { TOKENS, type TokenSymbol } from '../config/tokens';

export interface CreatePaymentInput {
  userId: string;
  recipientUsername: string;
  cryptoType: string;
  cryptoAmount: string;
  platformFeeAmount: string;
  platformFeeCrypto: string;
  totalCryptoAmount: string;
  senderCurrency: string;
  senderCurrencyAmount: string;
  receiverCurrency: string;
  receiverCurrencyAmount: string;
  cryptoToSenderRate: string;
  senderToReceiverRate: string;
  platformFeePercent: string;
}

interface PaymentQuoteInput {
  senderId: string;
  receiverUsername: string;
  cryptoType: string;
  senderCurrency: string;
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
  cryptoType: string;
  cryptoAmount: unknown;
  platformFeeAmount: unknown;
  platformFeeCrypto: unknown;
  totalCryptoAmount: unknown;
  senderCurrency: string;
  senderCurrencyAmount: unknown;
  receiverCurrency: string;
  receiverCurrencyAmount: unknown;
  cryptoToSenderRate: unknown;
  senderToReceiverRate: unknown;
  platformFeePercent: unknown;
  rateSource: string;
  rateSnapshotAt: Date;
  senderPublicKey: string;
  status: PaymentStatus;
  txHash: string | null;
  createdAt: Date;
  expiresAt: Date;
  completedAt: Date | null;
  failureReason: string | null;
}) => {
  return {
    ...payment,
    cryptoAmount: String(payment.cryptoAmount),
    platformFeeAmount: String(payment.platformFeeAmount),
    platformFeeCrypto: String(payment.platformFeeCrypto),
    totalCryptoAmount: String(payment.totalCryptoAmount),
    senderCurrencyAmount: String(payment.senderCurrencyAmount),
    receiverCurrencyAmount: String(payment.receiverCurrencyAmount),
    cryptoToSenderRate: String(payment.cryptoToSenderRate),
    senderToReceiverRate: String(payment.senderToReceiverRate),
    platformFeePercent: String(payment.platformFeePercent),
  };
};

const parseDecimalField = (field: string, value: string) => {
  try {
    const decimal = new Decimal(value);
    if (!decimal.isFinite()) throw new Error();
    return decimal;
  } catch {
    throw createHttpError(400, `${field} must be a valid decimal value.`);
  }
};

const normalizeCryptoType = (cryptoType: string): TokenSymbol => {
  const normalized = cryptoType.toUpperCase() as TokenSymbol;
  if (!(normalized in TOKENS)) {
    throw createHttpError(400, 'Unsupported cryptoType.');
  }
  return normalized;
};

const normalizeCurrency = (value: string) => value.toUpperCase();

const TOLERANCE = new Decimal('0.0005');

const relativeDiff = (submitted: Decimal, expected: Decimal) => {
  if (expected.eq(0)) return submitted.abs();
  return submitted.sub(expected).abs().div(expected.abs());
};

const buildQuoteExpiredError = (
  mismatches: Array<{
    field: string;
    submitted: Decimal;
    expected: Decimal;
    relativeDiff: Decimal;
  }>,
) => {
  throw createHttpError(
    400,
    'Quote has expired or amounts have changed. Please refresh and try again.',
    {
      details: {
        error: 'QUOTE_EXPIRED',
        message: 'Quote has expired or amounts have changed. Please refresh and try again.',
        details: mismatches.map((item) => ({
          field: item.field,
          submitted: item.submitted.toString(),
          expected: item.expected.toString(),
          relativeDiff: item.relativeDiff.toString(),
          tolerance: TOLERANCE.toString(),
        })),
      },
    },
  );
};

const ensureRateServices = async (
  cryptoType: TokenSymbol,
  senderCurrency: string,
  receiverCurrency: string,
) => {
  try {
    const [{ rate: liveCryptoRate, rateSource }, liveFiatRate] = await Promise.all([
      fetchCryptoRate(cryptoType, senderCurrency),
      fetchFiatRate(senderCurrency, receiverCurrency),
    ]);
    return { liveCryptoRate, liveFiatRate, rateSource };
  } catch {
    throw createHttpError(503, 'Rate service unavailable, please try again');
  }
};

export const getPaymentQuote = async (input: PaymentQuoteInput) => {
  const cryptoType = normalizeCryptoType(input.cryptoType);
  const senderCurrency = normalizeCurrency(input.senderCurrency);

  const receiver = await prisma.user.findUnique({
    where: { username: input.receiverUsername },
    select: { id: true, username: true },
  });
  if (!receiver) {
    throw createHttpError(404, 'Recipient not found.');
  }
  if (receiver.id === input.senderId) {
    throw createHttpError(400, 'Sender and recipient cannot be the same user.');
  }

  const receiverWallet = await prisma.wallet.findUnique({
    where: { userId: receiver.id },
    select: { currency: true },
  });
  if (!receiverWallet) {
    throw createHttpError(400, 'Receiver has no wallet profile configured.');
  }
  const receiverCurrency = normalizeCurrency(receiverWallet.currency);

  const { liveCryptoRate, liveFiatRate, rateSource } = await ensureRateServices(
    cryptoType,
    senderCurrency,
    receiverCurrency,
  );

  return {
    cryptoType,
    cryptoPriceInSenderCurrency: liveCryptoRate.toString(),
    senderCurrency,
    receiverCurrency,
    senderToReceiverRate: liveFiatRate.toString(),
    platformFeePercent: new Decimal(env.PLATFORM_FEE_PERCENT).toString(),
    rateSource,
    quoteExpiresIn: env.QUOTE_EXPIRES_IN_SECONDS,
  };
};

export const createPayment = async (input: CreatePaymentInput) => {
  const cryptoType = normalizeCryptoType(input.cryptoType);
  const senderCurrency = normalizeCurrency(input.senderCurrency);
  const submittedReceiverCurrency = normalizeCurrency(input.receiverCurrency);
  const submittedCryptoAmount = parseDecimalField('cryptoAmount', input.cryptoAmount);
  const submittedPlatformFeeAmount = parseDecimalField(
    'platformFeeAmount',
    input.platformFeeAmount,
  );
  const submittedPlatformFeeCrypto = parseDecimalField(
    'platformFeeCrypto',
    input.platformFeeCrypto,
  );
  const submittedTotalCryptoAmount = parseDecimalField(
    'totalCryptoAmount',
    input.totalCryptoAmount,
  );
  const submittedSenderCurrencyAmount = parseDecimalField(
    'senderCurrencyAmount',
    input.senderCurrencyAmount,
  );
  const submittedReceiverCurrencyAmount = parseDecimalField(
    'receiverCurrencyAmount',
    input.receiverCurrencyAmount,
  );
  const submittedCryptoToSenderRate = parseDecimalField(
    'cryptoToSenderRate',
    input.cryptoToSenderRate,
  );
  const submittedSenderToReceiverRate = parseDecimalField(
    'senderToReceiverRate',
    input.senderToReceiverRate,
  );
  const submittedPlatformFeePercent = parseDecimalField(
    'platformFeePercent',
    input.platformFeePercent,
  );

  if (submittedCryptoAmount.lte(0)) {
    throw createHttpError(400, 'cryptoAmount must be greater than 0.');
  }
  if (submittedSenderCurrencyAmount.lte(0)) {
    throw createHttpError(400, 'senderCurrencyAmount must be greater than 0.');
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
    select: { id: true, username: true, name: true },
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

  const receiverWallet = await prisma.wallet.findUnique({
    where: { userId: recipient.id },
    select: { currency: true },
  });
  if (!receiverWallet) {
    throw createHttpError(400, 'Receiver has no wallet profile configured.');
  }
  const receiverCurrency = normalizeCurrency(receiverWallet.currency);
  if (submittedReceiverCurrency !== receiverCurrency) {
    throw createHttpError(400, 'receiverCurrency does not match receiver wallet currency.');
  }

  const { liveCryptoRate, liveFiatRate, rateSource } = await ensureRateServices(
    cryptoType,
    senderCurrency,
    receiverCurrency,
  );
  const platformFeePercent = new Decimal(env.PLATFORM_FEE_PERCENT);

  const expectedPlatformFeeAmount = submittedSenderCurrencyAmount.mul(platformFeePercent).div(100);
  const expectedPlatformFeeCrypto = expectedPlatformFeeAmount.div(liveCryptoRate);
  const expectedCryptoAmount = submittedSenderCurrencyAmount.div(liveCryptoRate);
  const expectedTotalCryptoAmount = expectedCryptoAmount.add(expectedPlatformFeeCrypto);
  const expectedReceiverAmount = submittedSenderCurrencyAmount.mul(liveFiatRate);

  const checks = [
    {
      field: 'cryptoToSenderRate',
      submitted: submittedCryptoToSenderRate,
      expected: liveCryptoRate,
    },
    {
      field: 'senderToReceiverRate',
      submitted: submittedSenderToReceiverRate,
      expected: liveFiatRate,
    },
    {
      field: 'platformFeeAmount',
      submitted: submittedPlatformFeeAmount,
      expected: expectedPlatformFeeAmount,
    },
    {
      field: 'platformFeeCrypto',
      submitted: submittedPlatformFeeCrypto,
      expected: expectedPlatformFeeCrypto,
    },
    { field: 'cryptoAmount', submitted: submittedCryptoAmount, expected: expectedCryptoAmount },
    {
      field: 'totalCryptoAmount',
      submitted: submittedTotalCryptoAmount,
      expected: expectedTotalCryptoAmount,
    },
    {
      field: 'receiverCurrencyAmount',
      submitted: submittedReceiverCurrencyAmount,
      expected: expectedReceiverAmount,
    },
    {
      field: 'platformFeePercent',
      submitted: submittedPlatformFeePercent,
      expected: platformFeePercent,
    },
  ];

  const mismatches = checks
    .map((check) => ({ ...check, relativeDiff: relativeDiff(check.submitted, check.expected) }))
    .filter((check) => check.relativeDiff.gt(TOLERANCE));
  if (mismatches.length > 0) {
    buildQuoteExpiredError(mismatches);
  }

  const senderPublicKey = ensureValidPublicKey(sender.solanaPublicKey);
  const expiresAt = new Date(Date.now() + env.PAYMENT_EXPIRES_IN_MINUTES * 60_000);

  const payment = await prisma.payment.create({
    data: {
      senderId: sender.id,
      recipientUsername: recipient.username,
      recipientUserId: recipient.id,
      cryptoType,
      cryptoAmount: expectedCryptoAmount.toString(),
      platformFeeAmount: expectedPlatformFeeAmount.toString(),
      platformFeeCrypto: expectedPlatformFeeCrypto.toString(),
      totalCryptoAmount: expectedTotalCryptoAmount.toString(),
      senderCurrency,
      senderCurrencyAmount: submittedSenderCurrencyAmount.toString(),
      receiverCurrency,
      receiverCurrencyAmount: expectedReceiverAmount.toString(),
      cryptoToSenderRate: liveCryptoRate.toString(),
      senderToReceiverRate: liveFiatRate.toString(),
      platformFeePercent: platformFeePercent.toString(),
      rateSource,
      rateSnapshotAt: new Date(),
      senderPublicKey,
      status: PaymentStatus.pending,
      expiresAt,
    },
  });

  const built = await buildPaymentTransaction({
    paymentId: payment.id,
    senderPublicKey,
    cryptoType,
    totalCryptoAmount: payment.totalCryptoAmount.toString(),
  });

  logger.info('Payment created', {
    paymentId: payment.id,
    userId: sender.id,
    oldStatus: null,
    newStatus: PaymentStatus.pending,
  });

  return {
    paymentId: payment.id,
    recipientName: recipient.name,
    totalCryptoAmount: payment.totalCryptoAmount.toString(),
    cryptoType: payment.cryptoType,
    receiverCurrencyAmount: payment.receiverCurrencyAmount.toString(),
    receiverCurrency: payment.receiverCurrency,
    destinationWallet: env.NEXIO_WALLET,
    transaction: built.transactionBase64,
    expiresAt: payment.expiresAt.toISOString(),
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
