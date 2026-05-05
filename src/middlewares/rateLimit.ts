import type { NextFunction, Response } from 'express';
import createHttpError from 'http-errors';
import redis from '../config/redis.config';
import type { AuthenticatedRequest } from '../types/auth.type';

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 10;

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
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    if (count > MAX_REQUESTS) {
      throw createHttpError(429, 'Too many payment creation requests. Please try again later.');
    }

    return next();
  } catch (err) {
    return next(err);
  }
};
