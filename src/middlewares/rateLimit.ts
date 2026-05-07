import type { NextFunction, Response } from 'express';
import createHttpError from 'http-errors';
import redis from '../config/redis.config';
import type { AuthenticatedRequest } from '../types/auth.type';

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 10;
const WITHDRAWAL_WINDOW_SECONDS = 60 * 60;
const WITHDRAWAL_MAX_REQUESTS = 5;
const WITHDRAWAL_ACCOUNT_WINDOW_SECONDS = 60 * 60;
const WITHDRAWAL_ACCOUNT_MAX_REQUESTS = 10;

const enforceRateLimit = async (
  key: string,
  windowSeconds: number,
  maxRequests: number,
  errorMessage: string,
) => {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  if (count > maxRequests) {
    throw createHttpError(429, errorMessage);
  }
};

export const paymentCreateRateLimit = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }

    const key = `ratelimit:payment:create:${req.user.userId}`;
    await enforceRateLimit(
      key,
      WINDOW_SECONDS,
      MAX_REQUESTS,
      'Too many payment creation requests. Please try again later.',
    );

    return next();
  } catch (err) {
    return next(err);
  }
};

export const withdrawalCreateRateLimit = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }

    await enforceRateLimit(
      `ratelimit:withdrawal:${req.user.userId}`,
      WITHDRAWAL_WINDOW_SECONDS,
      WITHDRAWAL_MAX_REQUESTS,
      'Too many withdrawal requests. Please try again later.',
    );

    return next();
  } catch (err) {
    return next(err);
  }
};

export const withdrawalAccountCreateRateLimit = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }

    await enforceRateLimit(
      `ratelimit:withdrawal-account:${req.user.userId}`,
      WITHDRAWAL_ACCOUNT_WINDOW_SECONDS,
      WITHDRAWAL_ACCOUNT_MAX_REQUESTS,
      'Too many withdrawal account creation requests. Please try again later.',
    );

    return next();
  } catch (err) {
    return next(err);
  }
};
