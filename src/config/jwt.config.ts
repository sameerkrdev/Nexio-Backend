import jwt from 'jsonwebtoken';
import { env } from './dotenv.config.ts';
import type { JwtPayload } from '../types/auth.type.ts';
import createHttpError from 'http-errors';

// Decode base64-encoded PEM keys from environment
const privateKey = Buffer.from(env.JWT_PRIVATE_KEY, 'base64').toString('utf-8');
const publicKey = Buffer.from(env.JWT_PUBLIC_KEY, 'base64').toString('utf-8');

export const signAccessToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    expiresIn: env.JWT_ACCESS_EXPIRY as jwt.SignOptions['expiresIn'],
  });
};

export const verifyAccessToken = (token: string): JwtPayload => {
  try {
    const decoded = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
    }) as JwtPayload;
    return decoded;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw createHttpError(401, 'Access token has expired.');
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw createHttpError(401, 'Invalid access token.');
    }
    throw createHttpError(401, 'Token verification failed.');
  }
};
