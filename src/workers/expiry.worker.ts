import { PaymentStatus } from '../generated/prisma/client';
import logger from '../config/logger.config';
import prisma from '../config/prisma.config';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

const runCycle = async () => {
  const now = new Date();
  const result = await prisma.payment.updateMany({
    where: {
      status: PaymentStatus.pending,
      expiresAt: { lt: now },
    },
    data: {
      status: PaymentStatus.expired,
      failureReason: 'payment_expired',
    },
  });

  logger.info('Expiry worker cycle complete', {
    expiredCount: result.count,
  });
};

export const startExpiryWorker = () => {
  if (intervalHandle) return intervalHandle;
  intervalHandle = setInterval(() => {
    runCycle().catch((error) => {
      logger.error('Expiry worker cycle failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 60_000);

  return intervalHandle;
};

export const stopExpiryWorker = () => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
};
