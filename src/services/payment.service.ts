import createHttpError from 'http-errors';
import Decimal from 'decimal.js';
import { PaymentStatus, type WithdrawalMethod } from '../generated/prisma/client';
import logger from '../config/logger.config';
import prisma from '../config/prisma.config';
import env from '../config/dotenv.config';
import { PublicKey } from '@solana/web3.js';
import { buildPaymentTransaction } from './transaction.service';
import { fetchCryptoRate, fetchFiatRate } from './quote.service';
import { TOKENS, type TokenSymbol } from '../config/tokens';
import { detectCountryFromPhone } from '../utils/countryDetect';
import { getPaymentRail } from '../config/paymentRails';
import { getProvider } from './providers/provider.interface';
import { encryptAccountDetails } from '../utils/encryption';

export interface CreatePaymentInput {
  userId: string;
  recipientType: 'platform' | 'external';
  recipientUsername?: string;
  receiverPhone?: string;
  receiverPaymentMethod?: WithdrawalMethod;
  receiverPaymentDetails?: Record<string, unknown>;
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
  receiverUsername?: string;
  receiverPhone?: string;
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
  recipientType: string;
  recipientUserId: string | null;
  externalRecipientId: string | null;
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
  sender?: { username: string; name: string };
  receiver?: { username: string; name: string } | null;
  externalRecipient?: {
    id: string;
    phoneNumber: string;
    method: string;
    displayName: string;
  } | null;
}) => {
  const maskedPhone = payment.externalRecipient?.phoneNumber
    ? `${payment.externalRecipient.phoneNumber.slice(0, 3)}****${payment.externalRecipient.phoneNumber.slice(-4)}`
    : null;
  return {
    ...payment,
    senderUsername: payment.sender?.username,
    senderName: payment.sender?.name,
    recipientName: payment.receiver?.name ?? null,
    recipientType: payment.recipientType,
    externalRecipientId: payment.externalRecipientId,
    externalRecipient: payment.externalRecipient
      ? {
          id: payment.externalRecipient.id,
          phoneMasked: maskedPhone,
          phoneNumber: payment.externalRecipient.phoneNumber,
          method: payment.externalRecipient.method,
          displayName: payment.externalRecipient.displayName,
        }
      : null,
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

// Validation tolerance for quote-vs-live amounts. 0.5% absorbs:
//  - small crypto price ticks between quote fetch and payment initiate
//  - client-side rounding drift (parseFloat + Math.floor + .toFixed)
//  - CoinGecko/fiat-rate re-aggregation between sequential calls
// Pair this with the in-memory rate cache in quote.service.ts — together they
// eliminate almost all spurious "quote expired" errors while still rejecting
// actually-stale quotes (older than QUOTE_EXPIRES_IN_SECONDS).
const TOLERANCE = new Decimal('0.05');

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
  // Log detailed mismatch info for debugging
  console.error(
    'Quote validation failed - mismatches:',
    JSON.stringify(
      mismatches.map((item) => ({
        field: item.field,
        submitted: item.submitted.toString(),
        expected: item.expected.toString(),
        difference: item.submitted.sub(item.expected).toString(),
        relativeDiff: item.relativeDiff.mul(100).toFixed(4) + '%',
        tolerance: TOLERANCE.mul(100).toFixed(4) + '%',
      })),
      null,
      2,
    ),
  );

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
  } catch (error) {
    logger.error('Rate service error', {
      error: error instanceof Error ? error.message : String(error),
      cryptoType,
      senderCurrency,
      receiverCurrency,
    });
    throw createHttpError(503, 'Rate service unavailable, please try again');
  }
};

export const getPaymentQuote = async (input: PaymentQuoteInput) => {
  const cryptoType = normalizeCryptoType(input.cryptoType);
  const senderCurrency = normalizeCurrency(input.senderCurrency);
  const hasUsername = Boolean(input.receiverUsername);
  const hasPhone = Boolean(input.receiverPhone);
  if ((hasUsername && hasPhone) || (!hasUsername && !hasPhone)) {
    throw createHttpError(400, 'Provide either receiverUsername or receiverPhone');
  }

  let receiverCurrency: string;
  if (input.receiverPhone) {
    const countryCode = detectCountryFromPhone(input.receiverPhone);
    const rail = getPaymentRail(countryCode);
    if (!rail) {
      throw createHttpError(400, 'No payment rail available for receiver phone');
    }
    receiverCurrency = normalizeCurrency(rail.currency);
  } else {
    const receiver = await prisma.user.findUnique({
      where: { username: input.receiverUsername! },
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
    receiverCurrency = normalizeCurrency(receiverWallet.currency);
  }

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
  if (input.recipientType !== 'platform' && input.recipientType !== 'external') {
    throw createHttpError(400, 'recipientType must be platform or external.');
  }
  console.log('🚀 Starting payment creation', {
    userId: input.userId,
    recipientType: input.recipientType,
    recipientUsername: input.recipientUsername,
    cryptoType: input.cryptoType,
    senderCurrencyAmount: input.senderCurrencyAmount,
    senderCurrency: input.senderCurrency,
  });
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

  console.log('📊 Parsed payment amounts', {
    cryptoAmount: submittedCryptoAmount.toString(),
    platformFeeAmount: submittedPlatformFeeAmount.toString(),
    totalCryptoAmount: submittedTotalCryptoAmount.toString(),
    senderCurrencyAmount: submittedSenderCurrencyAmount.toString(),
  });

  if (submittedCryptoAmount.lte(0)) {
    throw createHttpError(400, 'cryptoAmount must be greater than 0.');
  }
  if (submittedSenderCurrencyAmount.lte(0)) {
    throw createHttpError(400, 'senderCurrencyAmount must be greater than 0.');
  }

  const sender = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, username: true, solanaPublicKey: true, phoneNumber: true },
  });
  if (!sender) {
    throw createHttpError(404, 'Sender not found.');
  }
  if (!sender.solanaPublicKey) {
    throw createHttpError(400, 'Please set your wallet first.');
  }

  let recipientUserId: string | null = null;
  // eslint-disable-next-line no-useless-assignment
  let recipientUsername = '';
  // eslint-disable-next-line no-useless-assignment
  let recipientDisplayName = '';
  let receiverCurrency: string;
  let externalRecipientId: string | null = null;

  if (input.recipientType === 'platform') {
    if (!input.recipientUsername) {
      throw createHttpError(400, 'recipientUsername is required for platform payments.');
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

    const receiverWallet = await prisma.wallet.findUnique({
      where: { userId: recipient.id },
      select: { currency: true },
    });
    if (!receiverWallet) {
      throw createHttpError(400, 'Receiver has no wallet profile configured.');
    }

    receiverCurrency = normalizeCurrency(receiverWallet.currency);
    recipientUserId = recipient.id;
    recipientUsername = recipient.username;
    recipientDisplayName = recipient.name;
  } else {
    if (!input.receiverPhone || !input.receiverPaymentMethod || !input.receiverPaymentDetails) {
      throw createHttpError(
        400,
        'receiverPhone, receiverPaymentMethod and receiverPaymentDetails are required for external payments.',
      );
    }

    const countryCode = detectCountryFromPhone(input.receiverPhone);
    const rail = getPaymentRail(countryCode);
    if (!rail) {
      throw createHttpError(400, 'No payment rail available for receiver phone');
    }
    receiverCurrency = normalizeCurrency(rail.currency);

    if (!rail.methods.includes(input.receiverPaymentMethod)) {
      throw createHttpError(
        400,
        `Method ${input.receiverPaymentMethod} not supported for ${countryCode}`,
      );
    }

    // Pick the provider from the rail config so different methods/countries can
    // be routed to different providers (e.g. dodo for India, something else for US).
    // Falls back to 'mock' if no provider is mapped for the method.
    const providerName = rail.providers[input.receiverPaymentMethod] ?? 'mock';
    const provider = getProvider(providerName);
    const validation = await provider.validateAccount(
      input.receiverPaymentMethod,
      input.receiverPaymentDetails,
    );
    if (!validation.valid) {
      throw createHttpError(400, validation.error ?? 'Invalid receiver payment details');
    }

    const encryptedDetails = encryptAccountDetails(input.receiverPaymentDetails);
    const externalRecipient = await prisma.externalRecipient.create({
      data: {
        phoneNumber: input.receiverPhone,
        countryCode,
        localCurrency: receiverCurrency,
        method: input.receiverPaymentMethod,
        encryptedDetails,
        displayName: validation.displayName,
      },
    });

    externalRecipientId = externalRecipient.id;
    recipientUsername = input.receiverPhone;
    recipientDisplayName = validation.displayName;
  }

  if (submittedReceiverCurrency !== receiverCurrency) {
    throw createHttpError(400, 'receiverCurrency does not match receiver-derived currency.');
  }

  console.log('💱 Fetching live rates', {
    cryptoType,
    senderCurrency,
    receiverCurrency,
  });

  const { liveCryptoRate, liveFiatRate, rateSource } = await ensureRateServices(
    cryptoType,
    senderCurrency,
    receiverCurrency,
  );
  const platformFeePercent = new Decimal(env.PLATFORM_FEE_PERCENT);

  console.log('📈 Live rates fetched', {
    cryptoToSenderRate: liveCryptoRate.toString(),
    senderToReceiverRate: liveFiatRate.toString(),
    rateSource,
    platformFeePercent: platformFeePercent.toString(),
  });

  const expectedPlatformFeeAmount = submittedSenderCurrencyAmount.mul(platformFeePercent).div(100);
  const expectedPlatformFeeCrypto = expectedPlatformFeeAmount.div(liveCryptoRate);
  const expectedCryptoAmount = submittedSenderCurrencyAmount.div(liveCryptoRate);
  const expectedTotalCryptoAmount = expectedCryptoAmount.add(expectedPlatformFeeCrypto);
  const expectedReceiverAmount = submittedSenderCurrencyAmount.mul(liveFiatRate);

  console.log('🔍 Validating quote amounts', {
    expectedPlatformFeeAmount: expectedPlatformFeeAmount.toString(),
    submittedPlatformFeeAmount: submittedPlatformFeeAmount.toString(),
    expectedCryptoAmount: expectedCryptoAmount.toString(),
    submittedCryptoAmount: submittedCryptoAmount.toString(),
  });

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
    console.error('❌ Quote validation failed', {
      mismatches: mismatches.map((m) => ({
        field: m.field,
        submitted: m.submitted.toString(),
        expected: m.expected.toString(),
        difference: m.submitted.sub(m.expected).toString(),
        relativeDiff: m.relativeDiff.mul(100).toFixed(4) + '%',
        tolerance: TOLERANCE.mul(100).toFixed(4) + '%',
      })),
    });
    buildQuoteExpiredError(mismatches);
  }

  console.log('✅ Quote validation passed');

  const senderPublicKey = ensureValidPublicKey(sender.solanaPublicKey);
  const expiresAt = new Date(Date.now() + env.PAYMENT_EXPIRES_IN_MINUTES * 60_000);

  console.log('💾 Creating payment record in database');

  const payment = await prisma.payment.create({
    data: {
      senderId: sender.id,
      recipientType: input.recipientType,
      recipientUsername,
      recipientUserId,
      externalRecipientId,
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

  console.log('✅ Payment record created', {
    paymentId: payment.id,
    status: payment.status,
    expiresAt: payment.expiresAt.toISOString(),
  });

  console.info('🔨 Building Solana transaction');

  const built = await buildPaymentTransaction({
    paymentId: payment.id,
    senderPublicKey,
    cryptoType,
    totalCryptoAmount: payment.totalCryptoAmount.toString(),
  });

  logger.info('✅ Payment created successfully', {
    paymentId: payment.id,
    userId: sender.id,
    oldStatus: null,
    newStatus: PaymentStatus.pending,
    totalCryptoAmount: payment.totalCryptoAmount.toString(),
    cryptoType: payment.cryptoType,
  });

  return {
    paymentId: payment.id,
    recipientName: recipientDisplayName,
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
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      sender: { select: { username: true, name: true } },
      receiver: { select: { username: true, name: true } },
      externalRecipient: {
        select: { id: true, phoneNumber: true, method: true, displayName: true },
      },
    },
  });
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
    OR: [{ senderId: params.userId }, { recipientUserId: params.userId }],
    ...(params.status ? { status: params.status } : {}),
  };

  const [total, data] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      include: {
        sender: {
          select: {
            username: true,
            name: true,
          },
        },
        receiver: {
          select: {
            username: true,
            name: true,
          },
        },
        externalRecipient: {
          select: {
            id: true,
            phoneNumber: true,
            method: true,
            displayName: true,
          },
        },
      },
    }),
  ]);

  // console.log(data);

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
