import env from '../config/dotenv.config';
import logger from '../config/logger.config';
import prisma from '../config/prisma.config';
import { getProvider } from '../services/providers/provider.interface';
import { refundWithdrawal } from '../services/withdrawal.service';

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
          await refundWithdrawal(withdrawal.id);
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
