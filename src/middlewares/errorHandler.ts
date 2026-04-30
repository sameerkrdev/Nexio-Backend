import type { Request, Response, NextFunction } from 'express';
import { isHttpError } from 'http-errors';
import logger from '../config/logger';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler = (err: unknown, req: Request, res: Response, next: NextFunction) => {
  const isHttp = isHttpError(err);

  const statusCode = isHttp ? err.statusCode : 500;
  const message = isHttp ? err.message : 'Internal Server Error';

  const safeBody =
    req.body && typeof req.body === 'object'
      ? {
          ...req.body,
          ...(req.body.password && { password: null }),
        }
      : undefined;

  logger.error({
    statusCode,
    message,
    stack: err instanceof Error ? err.stack : undefined,
    method: req.method,
    path: req.originalUrl,
    params: req.params,
    query: req.query,
    body: safeBody,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    details: isHttp ? (err as any).details : undefined,
  });

  return res.status(statusCode).json({
    success: false,
    message,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(isHttp && (err as any).details && { details: (err as any).details }),
  });
};
