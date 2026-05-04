import createHttpError from 'http-errors';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma.config';
import { sendSmsOtp } from '../config/twilio.config';
import logger from '../config/logger.config';
import { checkRateLimit, generateOtp, storeOtp, validateOtp } from './otp.service';
import { issueTokenPair, rotateRefreshToken, revokeRefreshToken } from './token.service';
import { BCRYPT_ROUNDS } from '../constants';
import type { TokenPair } from '../types/auth.type';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const maskPhone = (phone: string): string => phone.replace(/(\+\d{1,3})\d+(\d{4})$/, '$1****$2');

// ─── 1. Check Username Availability ──────────────────────────────────────────

export const checkUsername = async (
  username: string,
): Promise<{ available: boolean; exists: boolean }> => {
  const existing = await prisma.user.findUnique({ where: { username } });

  logger.info('Username availability checked', {
    username,
    available: !existing,
    exists: !!existing,
  });

  return { available: !existing, exists: !!existing };
};

// ─── 2. Send OTP ──────────────────────────────────────────────────────────────

/**
 * For login:  verify user exists, then send OTP keyed by phoneNumber.
 * For signup: just send OTP keyed by username (user creation happens after verify).
 *
 * @param phoneNumber  E.164 phone number
 * @param purpose      "signup" | "login"
 * @param username     Required for signup — used as the Redis OTP key identifier
 */
export const sendOtp = async (params: {
  purpose: 'signup' | 'login';
  phoneNumber?: string;
  username?: string;
  identifier?: string;
}): Promise<void> => {
  const { purpose, phoneNumber, username, identifier } = params;
  logger.info('[DEBUG] sendOtp called', { purpose, phoneNumber, username, identifier });

  if (purpose === 'login') {
    logger.info(`[DEBUG] Looking up user with identifier: ${identifier}`);
    // Ensure user exists before sending OTP
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ username: identifier }, { phoneNumber: identifier }],
      },
    });

    if (!user) {
      logger.info(`[DEBUG] User not found for identifier: ${identifier}`);
      throw createHttpError(404, 'No account found with this username or phone number.');
    }

    logger.info(`[DEBUG] User found: ${user.username}, checking rate limit...`);
    // Rate-limit check on phone number
    await checkRateLimit(user.phoneNumber);

    const otp = generateOtp();
    logger.info(`[DEBUG] Generated OTP: ${otp}, storing in Redis...`);
    await storeOtp(identifier as string, 'login', otp);

    // await sendSmsOtp(user.phoneNumber, otp);
    logger.info(`[DEV] Login OTP for ${identifier}: ${otp}`, { otp, identifier });

    logger.info('Login OTP sent', { identifier, phone: maskPhone(user.phoneNumber) });
  } else {
    // Rate-limit check on phone number (for signup)
    logger.info(`[DEBUG] Signup flow: checking rate limit for ${phoneNumber}`);
    await checkRateLimit(phoneNumber as string);

    const existingUsername = await prisma.user.findUnique({
      where: { username: username as string },
    });
    if (existingUsername) {
      logger.info(`[DEBUG] Signup flow: username already taken: ${username}`);
      throw createHttpError(409, 'Username is already taken.');
    }

    const existingPhone = await prisma.user.findUnique({
      where: { phoneNumber: phoneNumber as string },
    });
    if (existingPhone) {
      logger.info(`[DEBUG] Signup flow: phone number already exists: ${phoneNumber}`);
      throw createHttpError(409, 'An account with this phone number already exists.');
    }

    const otp = generateOtp();
    logger.info(`[DEBUG] Signup flow: Generated OTP: ${otp}, storing in Redis for ${username}`);
    // Key the OTP by username so the verify step can use it even before the user is created
    await storeOtp(username as string, 'signup', otp);
    // await sendSmsOtp(phoneNumber as string, otp);
    logger.info(`[DEV] Signup OTP for ${username}: ${otp}`, { otp, username });

    logger.info('Signup OTP sent', {
      username: username as string,
      phone: maskPhone(phoneNumber as string),
    });
  }
};

// ─── 3a. Signup via OTP ───────────────────────────────────────────────────────

const signupWithOtp = async (params: {
  username: string;
  name: string;
  phoneNumber: string;
  password?: string;
  otp: string;
  deviceId: string;
}): Promise<TokenPair> => {
  const { username, name, phoneNumber, password, otp, deviceId } = params;

  // Validate OTP (keyed by username)
  await validateOtp(username, 'signup', otp);

  // Double-check uniqueness at creation time (race-condition guard)
  const [existingUsername, existingPhone] = await Promise.all([
    prisma.user.findUnique({ where: { username } }),
    prisma.user.findUnique({ where: { phoneNumber } }),
  ]);

  if (existingUsername) {
    throw createHttpError(409, 'Username is already taken.');
  }
  if (existingPhone) {
    throw createHttpError(409, 'An account with this phone number already exists.');
  }

  // Hash password if provided
  const hashedPassword = password ? await bcrypt.hash(password, BCRYPT_ROUNDS) : null;

  // Create user
  const user = await prisma.user.create({
    data: {
      username,
      name,
      phoneNumber,
      password: hashedPassword,
    },
  });

  logger.info('New user created via OTP signup', {
    userId: user.id,
    username,
    hasPassword: !!password,
  });

  return issueTokenPair(user.id, user.username, deviceId);
};

// ─── 3b. Login via OTP ────────────────────────────────────────────────────────

const loginWithOtp = async (params: {
  identifier: string;
  otp: string;
  deviceId: string;
}): Promise<TokenPair> => {
  const { identifier, otp, deviceId } = params;

  // Validate OTP (keyed by identifier)
  await validateOtp(identifier, 'login', otp);

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ username: identifier }, { phoneNumber: identifier }],
    },
  });

  if (!user) {
    // Should not happen since sendOtp validated existence, but guard anyway
    throw createHttpError(404, 'User not found.');
  }

  logger.info('User logged in via OTP', { userId: user.id, username: user.username });

  return issueTokenPair(user.id, user.username, deviceId);
};

// ─── 3. Unified Verify OTP (dispatches signup or login) ──────────────────────

export const verifyOtp = async (params: {
  otp: string;
  purpose: 'signup' | 'login';
  deviceId: string;
  phoneNumber?: string;
  username?: string;
  name?: string;
  password?: string;
  identifier?: string;
}): Promise<TokenPair> => {
  const { purpose, phoneNumber, otp, deviceId, username, name, password, identifier } = params;

  if (purpose === 'signup') {
    if (!username || !name || !phoneNumber) {
      throw createHttpError(400, 'username, phoneNumber, and name are required for signup.');
    }
    return signupWithOtp({ username, name, phoneNumber, password, otp, deviceId });
  }

  if (!identifier) {
    throw createHttpError(400, 'identifier is required for login.');
  }
  return loginWithOtp({ identifier, otp, deviceId });
};

// ─── 4. Password Login ────────────────────────────────────────────────────────

export const loginWithPassword = async (params: {
  username: string;
  password: string;
  deviceId: string;
}): Promise<TokenPair> => {
  const { username, password, deviceId } = params;

  // Find user by username
  const user = await prisma.user.findUnique({
    where: { username },
  });

  if (!user) {
    throw createHttpError(401, 'Invalid username or password.');
  }

  // Check if user has a password set
  if (!user.password) {
    throw createHttpError(401, 'Password login not available. Please use OTP login.');
  }

  // Verify password
  const isValidPassword = await bcrypt.compare(password, user.password);

  if (!isValidPassword) {
    throw createHttpError(401, 'Invalid username or password.');
  }

  logger.info('User logged in with password', { userId: user.id, username: user.username });

  return issueTokenPair(user.id, user.username, deviceId);
};

// ─── 5. Refresh Token Rotation ────────────────────────────────────────────────

export const refresh = async (rawRefreshToken: string, deviceId: string): Promise<TokenPair> => {
  return rotateRefreshToken(rawRefreshToken, deviceId);
};

// ─── 6. Logout ────────────────────────────────────────────────────────────────

export const logout = async (rawRefreshToken: string): Promise<void> => {
  return revokeRefreshToken(rawRefreshToken);
};

// ─── 7. Get Current User ─────────────────────────────────────────────────────

export const getMe = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, name: true, phoneNumber: true, createdAt: true },
  });

  if (!user) {
    throw createHttpError(404, 'User not found.');
  }

  return user;
};
