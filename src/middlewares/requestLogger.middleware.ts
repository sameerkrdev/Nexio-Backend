import type { NextFunction, Request, Response } from 'express';
import logger from '../config/logger.config';

export const requestLoggerMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const isWebhook = req.originalUrl.includes('/api/v1/webhooks/helius');

  res.on('finish', () => {
    if (isWebhook) return;
    logger.info('HTTP request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start,
    });
  });

  next();
};
