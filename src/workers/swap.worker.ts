import env from '../config/dotenv.config';
import logger from '../config/logger.config';
import { runRetryableSwapBatches, runSwapBatchForAllTokens } from '../services/swap.service';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

const runCycle = async () => {
  const startedAt = Date.now();
  logger.info('Swap worker tick started');

  try {
    await runRetryableSwapBatches();
    await runSwapBatchForAllTokens();
    logger.info('Swap worker tick completed', {
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    logger.error('Swap worker tick failed', {
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const startSwapWorker = () => {
  if (intervalHandle) return intervalHandle;

  const intervalMs = env.SWAP_BATCH_INTERVAL_MINUTES * 60_000;
  intervalHandle = setInterval(() => {
    void runCycle();
  }, intervalMs);

  void runCycle();
  logger.info('Swap worker started', {
    intervalMinutes: env.SWAP_BATCH_INTERVAL_MINUTES,
  });

  return intervalHandle;
};

export const stopSwapWorker = () => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
};
