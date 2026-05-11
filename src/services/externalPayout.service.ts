import Decimal from 'decimal.js';
import logger from '../config/logger.config';
import prisma from '../config/prisma.config';
import env from '../config/dotenv.config';
import { getProvider } from './providers/provider.interface';
import { getOrCreateWallet } from './wallet.service';

export const processExternalPayout = async (paymentId: string): Promise<void> => {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      externalRecipient: true,
    },
  });

  if (!payment || payment.recipientType !== 'external' || !payment.externalRecipient) {
    return;
  }

  const existing = await prisma.withdrawal.findUnique({
    where: { externalPaymentId: payment.id },
    select: { id: true, status: true },
  });
  if (existing) {
    return;
  }

  const provider = getProvider('mock');

  try {
    const result = await provider.submitPayout({
      amount: new Decimal(payment.receiverCurrencyAmount.toString()),
      currency: payment.receiverCurrency,
      method: payment.externalRecipient.method,
      encryptedAccountDetails: payment.externalRecipient.encryptedDetails,
      withdrawalId: payment.id,
    });

    const platformWallet = await getOrCreateWallet(env.PLATFORM_USER_ID);

    await prisma.withdrawal.create({
      data: {
        userId: env.PLATFORM_USER_ID,
        walletId: platformWallet.id,
        accountId: null,
        externalPaymentId: payment.id,
        isExternalPayout: true,
        amount: payment.receiverCurrencyAmount.toString(),
        currency: payment.receiverCurrency,
        feeAmount: '0',
        netAmount: payment.receiverCurrencyAmount.toString(),
        status: 'processing',
        method: payment.externalRecipient.method,
        countryCode: payment.externalRecipient.countryCode,
        providerName: 'mock',
        providerReference: result.providerReference,
        providerResponse: {
          stage: 'submit',
          providerReference: result.providerReference,
          estimatedArrival: result.estimatedArrival,
        },
        isMocked: true,
        mockCompletesAt: result.mockCompletesAt,
        estimatedArrival: result.estimatedArrival,
      },
    });
  } catch (error) {
    logger.error('External payout initiation failed', {
      paymentId: payment.id,
      error: error instanceof Error ? error.message : String(error),
    });
    await prisma.payment.update({
      where: { id: payment.id },
      data: { failureReason: 'External payout initiation failed' },
    });
  }
};
