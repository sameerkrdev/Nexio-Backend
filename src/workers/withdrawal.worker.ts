import env from '../config/dotenv.config';
import logger from '../config/logger.config';
import prisma from '../config/prisma.config';
import { getProvider } from '../services/providers/provider.interface';
import { refundWithdrawal } from '../services/withdrawal.service';
import { sendSms } from '../services/twilio.service';

const getCurrencySymbol = (currency: string): string => {
  const symbols: Record<string, string> = {
    INR: '₹',
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    SGD: '$',
    AUD: '$',
    CAD: '$',
  };
  return symbols[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
};

let intervalHandle: ReturnType<typeof setInterval> | null = null;

const runCycle = async () => {
  try {
    const dueWithdrawals = await prisma.withdrawal.findMany({
      where: {
        status: 'processing',
        isMocked: true,
        mockCompletesAt: {
          lte: new Date(),
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    let completedCount = 0;
    let failedCount = 0;

    for (const withdrawal of dueWithdrawals) {
      if (!withdrawal.providerReference) {
        continue;
      }

      try {
        const provider = getProvider(withdrawal.providerName);
        const statusResult = await provider.checkStatus(withdrawal.providerReference);

        if (statusResult.status === 'completed') {
          await prisma.withdrawal.update({
            where: { id: withdrawal.id },
            data: {
              status: 'completed',
              completedAt: new Date(),
            },
          });
          if (withdrawal.isExternalPayout && withdrawal.externalPaymentId) {
            const payment = await prisma.payment.findUnique({
              where: { id: withdrawal.externalPaymentId },
              include: { externalRecipient: true },
            });
            if (payment?.externalRecipient) {
              sendSms(
                payment.externalRecipient.phoneNumber,
                `${getCurrencySymbol(payment.receiverCurrency)}${payment.receiverCurrencyAmount.toString()} has been deposited to your ${payment.externalRecipient.displayName} via NexaPay.`,
              ).catch(() => {
                // sendSms already logs failures
              });
            }
          }
          completedCount += 1;
          continue;
        }

        if (statusResult.status === 'failed') {
          await prisma.withdrawal.update({
            where: { id: withdrawal.id },
            data: {
              status: 'failed',
              failureReason: statusResult.failureReason ?? 'Provider reported failure',
            },
          });
          if (!withdrawal.isExternalPayout) {
            await refundWithdrawal(withdrawal.id);
          } else if (withdrawal.externalPaymentId) {
            await prisma.payment.update({
              where: { id: withdrawal.externalPaymentId },
              data: {
                failureReason:
                  statusResult.failureReason ?? 'External payout failed at provider status check',
              },
            });
          }
          failedCount += 1;
        }
      } catch (error) {
        logger.error('Withdrawal worker failed processing item', {
          withdrawalId: withdrawal.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Withdrawal worker cycle complete', {
      checkedCount: dueWithdrawals.length,
      completedCount,
      failedCount,
    });
  } catch (error) {
    logger.error('Withdrawal worker cycle failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const startWithdrawalWorker = () => {
  if (intervalHandle) return intervalHandle;

  intervalHandle = setInterval(() => {
    void runCycle();
  }, env.WITHDRAWAL_WORKER_INTERVAL_MS);

  logger.info('Withdrawal worker started', {
    intervalMs: env.WITHDRAWAL_WORKER_INTERVAL_MS,
  });

  return intervalHandle;
};

export const stopWithdrawalWorker = () => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
};
