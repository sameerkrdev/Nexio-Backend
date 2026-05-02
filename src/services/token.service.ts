import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import createHttpError from 'http-errors';
import prisma from '../config/prisma.config';
import { signAccessToken } from '../config/jwt.config';
import logger from '../config/logger.config';
import { BCRYPT_ROUNDS, REFRESH_TOKEN_EXPIRY_DAYS } from '../constants';
import type { JwtPayload, TokenPair } from '../types/auth.type';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a 128-char hex raw refresh token (64 random bytes) */
export const generateRawRefreshToken = (): string => crypto.randomBytes(64).toString('hex');

/** SHA-256 deterministic hash for fast DB lookup */
export const computeLookupHash = (rawToken: string): string =>
  crypto.createHash('sha256').update(rawToken).digest('hex');

/** bcrypt hash for secure storage */
export const hashToken = async (rawToken: string): Promise<string> =>
  bcrypt.hash(rawToken, BCRYPT_ROUNDS);

/** bcrypt comparison */
export const compareTokenHash = async (rawToken: string, hash: string): Promise<boolean> =>
  bcrypt.compare(rawToken, hash);

// ─── Issue Token Pair ─────────────────────────────────────────────────────────

/**
 * Sign a new access token + generate/store a new refresh token.
 * Returns both as a TokenPair.
 */
export const issueTokenPair = async (
  userId: string,
  username: string,
  deviceId: string,
): Promise<TokenPair> => {
  const payload: JwtPayload = { userId, username };
  const accessToken = signAccessToken(payload);

  const rawRefreshToken = generateRawRefreshToken();
  const lookupHash = computeLookupHash(rawRefreshToken);
  const tokenHash = await hashToken(rawRefreshToken);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  await prisma.refreshToken.create({
    data: { userId, tokenHash, lookupHash, deviceId, expiresAt },
  });

  logger.info('Token pair issued', { userId, deviceId });

  return { accessToken, refreshToken: rawRefreshToken };
};

// ─── Rotate Refresh Token ─────────────────────────────────────────────────────

/**
 * Validate the incoming raw refresh token, delete it, and issue a new pair.
 *
 * Uses lookupHash (SHA-256) for O(1) DB lookup, then bcrypt to verify.
 * On token reuse (lookupHash found but bcrypt fails), revokes all device tokens.
 */
export const rotateRefreshToken = async (
  rawRefreshToken: string,
  deviceId: string,
): Promise<TokenPair> => {
  const lookupHash = computeLookupHash(rawRefreshToken);

  const storedToken = await prisma.refreshToken.findUnique({
    where: { lookupHash },
    include: { user: true },
  });

  if (!storedToken) {
    // Token not in DB — possible reuse of an already-rotated token.
    // Revoke all tokens for this deviceId as a precaution.
    logger.warn('Refresh token reuse detected — revoking all device sessions', { deviceId });
    await prisma.refreshToken.deleteMany({ where: { deviceId } });
    throw createHttpError(
      401,
      'Invalid refresh token. All sessions on this device have been revoked.',
    );
  }

  // Verify bcrypt hash
  const isValid = await compareTokenHash(rawRefreshToken, storedToken.tokenHash);
  if (!isValid) {
    // Hash collision extremely unlikely; treat as reuse
    logger.warn('Refresh token hash mismatch — revoking device sessions', { deviceId });
    await prisma.refreshToken.deleteMany({ where: { deviceId } });
    throw createHttpError(
      401,
      'Invalid refresh token. All sessions on this device have been revoked.',
    );
  }

  // Expiry check
  if (new Date() > storedToken.expiresAt) {
    await prisma.refreshToken.delete({ where: { id: storedToken.id } });
    throw createHttpError(401, 'Refresh token has expired. Please log in again.');
  }

  // Delete the consumed token
  await prisma.refreshToken.delete({ where: { id: storedToken.id } });

  logger.info('Refresh token rotated', { userId: storedToken.userId, deviceId });

  return issueTokenPair(storedToken.userId, storedToken.user.username, deviceId);
};

// ─── Revoke Refresh Token (Logout) ────────────────────────────────────────────

/**
 * Revoke a refresh token by its SHA-256 lookup hash.
 * Silently succeeds if the token is not found (idempotent logout).
 */
export const revokeRefreshToken = async (rawRefreshToken: string): Promise<void> => {
  const lookupHash = computeLookupHash(rawRefreshToken);

  const deleted = await prisma.refreshToken.deleteMany({ where: { lookupHash } });

  if (deleted.count > 0) {
    logger.info('Refresh token revoked', { lookupHash: lookupHash.slice(0, 12) + '…' });
  } else {
    logger.warn('Attempted to revoke non-existent refresh token');
  }
};
