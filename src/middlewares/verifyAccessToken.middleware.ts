import type { Response, NextFunction } from 'express';
import createHttpError from 'http-errors';
import { verifyAccessToken } from '../config/jwt.config';
import type { AuthenticatedRequest } from '../types/auth.type';

/**
 * Middleware: verify the RS256 access token from the Authorization header.
 * Attaches decoded payload to req.user on success.
 */
export const verifyAccessTokenMiddleware = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw createHttpError(
        401,
        'Authorization header missing or malformed. Expected: Bearer <token>',
      );
    }

    const token = authHeader.slice(7); // strip "Bearer "

    if (!token) {
      throw createHttpError(401, 'Access token is missing.');
    }

    const payload = verifyAccessToken(token);
    req.user = payload;

    next();
  } catch (err) {
    next(err);
  }
};
