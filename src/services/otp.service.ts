import crypto from 'crypto';
import createHttpError from 'http-errors';
import redis from '../config/redis.config';
import logger from '../config/logger.config';
import {
  OTP_LENGTH,
  OTP_TTL_SECONDS,
  OTP_RATE_LIMIT_MAX,
  OTP_RATE_LIMIT_WINDOW_SECONDS,
} from '../constants';
import type { OtpData } from '../types/auth.type';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const maskPhone = (phone: string): string => phone.replace(/(\+\d{1,3})\d+(\d{4})$/, '$1****$2');

/**
 * Redis key for the OTP hash.
 * Signup: keyed by username (user not yet created)
 * Login:  keyed by phoneNumber (user already exists)
 */
const getOtpKey = (identifier: string, purpose: 'signup' | 'login'): string =>
  `otp:${purpose}:${identifier}`;

/** Redis key for the per-phone rate-limit counter */
const getRateLimitKey = (phoneNumber: string): string => `ratelimit:otp:${phoneNumber}`;

// ─── OTP Generation ───────────────────────────────────────────────────────────

/** Generate a cryptographically secure 6-digit OTP */
export const generateOtp = (): string => {
  const digits = Math.pow(10, OTP_LENGTH);
  return String(crypto.randomInt(digits / 10, digits)).padStart(OTP_LENGTH, '0');
};

// ─── Rate Limiting ────────────────────────────────────────────────────────────

/**
 * Increment the OTP send counter for a phone number.
 * Throws 429 if the limit is exceeded within the window.
 */
export const checkRateLimit = async (phoneNumber: string): Promise<void> => {
  const key = getRateLimitKey(phoneNumber);
  const current = await redis.incr(key);

  // Set TTL only on the first request in this window
  if (current === 1) {
    await redis.expire(key, OTP_RATE_LIMIT_WINDOW_SECONDS);
  }

  if (current > OTP_RATE_LIMIT_MAX) {
    logger.warn('OTP rate limit exceeded', { phone: maskPhone(phoneNumber) });
    throw createHttpError(429, `Too many OTP requests. Please wait before requesting again.`);
  }
};

// ─── OTP Storage ─────────────────────────────────────────────────────────────

/**
 * Store OTP in Redis as a hash with expiry and used-flag.
 *
 * For signup: identifier = username
 * For login:  identifier = phoneNumber
 */
export const storeOtp = async (
  identifier: string,
  purpose: 'signup' | 'login',
  otp: string,
): Promise<void> => {
  const key = getOtpKey(identifier, purpose);
  const expiryMs = Date.now() + OTP_TTL_SECONDS * 1000;

  await redis.hset(key, {
    otp,
    expiry: String(expiryMs),
    used: 'false',
  });
  await redis.expire(key, OTP_TTL_SECONDS);

  logger.info('OTP stored in Redis', { key, ttl: OTP_TTL_SECONDS });
};

// ─── OTP Retrieval & Validation ───────────────────────────────────────────────

/** Fetch OTP hash from Redis; returns null if key does not exist */
export const getOtp = async (
  identifier: string,
  purpose: 'signup' | 'login',
): Promise<OtpData | null> => {
  const key = getOtpKey(identifier, purpose);
  const data = await redis.hgetall(key);

  if (!data || !data['otp']) return null;

  return data as unknown as OtpData;
};

/** Delete OTP key from Redis */
export const deleteOtp = async (identifier: string, purpose: 'signup' | 'login'): Promise<void> => {
  const key = getOtpKey(identifier, purpose);
  await redis.del(key);
};

/**
 * Validate the provided OTP against the stored value.
 * - Throws if not found / expired / already used / mismatch.
 * - On success, atomically deletes the key to prevent reuse.
 */
export const validateOtp = async (
  identifier: string,
  purpose: 'signup' | 'login',
  providedOtp: string,
): Promise<void> => {
  const otpData = await getOtp(identifier, purpose);

  if (!otpData) {
    throw createHttpError(400, 'OTP not found or has expired. Please request a new one.');
  }

  // Reuse check: if already used, purge and reject
  if (otpData.used === 'true') {
    await deleteOtp(identifier, purpose);
    throw createHttpError(400, 'OTP has already been used. Please request a new one.');
  }

  // Expiry check (belt-and-suspenders on top of Redis TTL)
  const expiry = parseInt(otpData.expiry, 10);
  if (Date.now() > expiry) {
    await deleteOtp(identifier, purpose);
    throw createHttpError(400, 'OTP has expired. Please request a new one.');
  }

  // Constant-time comparison to prevent timing attacks
  const storedBuffer = Buffer.from(otpData.otp);
  const providedBuffer = Buffer.from(providedOtp);

  const isValid =
    storedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(storedBuffer, providedBuffer);

  if (!isValid) {
    throw createHttpError(400, 'Invalid OTP. Please try again.');
  }

  // Immediately delete on success — prevents any reuse
  await deleteOtp(identifier, purpose);
};
