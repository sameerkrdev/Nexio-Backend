import app from './app';
import env from './config/dotenv.config';
import logger from './config/logger.config';
import prisma from './config/prisma.config';
import redis from './config/redis.config';
import { startExpiryWorker, stopExpiryWorker } from './workers/expiry.worker';
import { startSwapWorker, stopSwapWorker } from './workers/swap.worker';
import { validateStartupConfig } from './config/startupValidation';
import { recoverStaleSwapBatches } from './services/swap.service';
let server: ReturnType<typeof app.listen>;
let isShuttingDown = false;

const shutdown = async (code = 0) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info('Shutting down application...');

  try {
    if (server) {
      logger.info('Closing HTTP server...');

      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      logger.info('HTTP server closed');
    }

    stopExpiryWorker();
    stopSwapWorker();
    await prisma.$disconnect();
    redis.disconnect();
  } catch (err) {
    logger.error('Error during shutdown', err);
  } finally {
    process.exit(code);
  }
};

// Process-level handlers
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection', { reason });
  shutdown(1);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { err });
  shutdown(1);
});

const startServer = async () => {
  await validateStartupConfig();
  await recoverStaleSwapBatches();
  const PORT = env.PORT;
  server = app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
  startExpiryWorker();
  startSwapWorker();
};

try {
  void startServer();
} catch (err) {
  logger.error('Startup failed', err);
  process.exit(1);
}
