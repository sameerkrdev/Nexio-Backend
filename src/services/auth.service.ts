import createHttpError from 'http-errors';
import prisma from '../config/prisma.config';
import { sendSmsOtp } from '../config/twilio.config';
import logger from '../config/logger.config';
import { checkRateLimit, generateOtp, storeOtp, validateOtp } from './otp.service';
import { issueTokenPair, rotateRefreshToken, revokeRefreshToken } from './token.service';
import type { TokenPair } from '../types/auth.type';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const maskPhone = (phone: string): string => phone.replace(/(\+\d{1,3})\d+(\d{4})$/, '$1****$2');

// ─── 1. Check Username Availability ──────────────────────────────────────────

export const checkUsername = async (username: string): Promise<{ available: boolean }> => {
  const existing = await prisma.user.findUnique({ where: { username } });

  logger.info('Username availability checked', { username, available: !existing });

  return { available: !existing };
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

  if (purpose === 'login') {
    // Ensure user exists before sending OTP
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ username: identifier }, { phoneNumber: identifier }],
      },
    });

    if (!user) {
      throw createHttpError(404, 'No account found with this username or phone number.');
    }

    // Rate-limit check on phone number
    await checkRateLimit(user.phoneNumber);

    const otp = generateOtp();
    await storeOtp(identifier as string, 'login', otp);
    await sendSmsOtp(user.phoneNumber, otp);

    logger.info('Login OTP sent', { identifier, phone: maskPhone(user.phoneNumber) });
  } else {
    // Rate-limit check on phone number (for signup)
    await checkRateLimit(phoneNumber as string);

    const existingUsername = await prisma.user.findUnique({
      where: { username: username as string },
    });
    if (existingUsername) {
      throw createHttpError(409, 'Username is already taken.');
    }

    const existingPhone = await prisma.user.findUnique({
      where: { phoneNumber: phoneNumber as string },
    });
    if (existingPhone) {
      throw createHttpError(409, 'An account with this phone number already exists.');
    }

    const otp = generateOtp();
    // Key the OTP by username so the verify step can use it even before the user is created
    await storeOtp(username as string, 'signup', otp);
    await sendSmsOtp(phoneNumber as string, otp);

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
  otp: string;
  deviceId: string;
}): Promise<TokenPair> => {
  const { username, name, phoneNumber, otp, deviceId } = params;

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

  // Create user
  const user = await prisma.user.create({
    data: { username, name, phoneNumber },
  });

  logger.info('New user created via OTP signup', { userId: user.id, username });

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
  identifier?: string;
}): Promise<TokenPair> => {
  const { purpose, phoneNumber, otp, deviceId, username, name, identifier } = params;

  if (purpose === 'signup') {
    if (!username || !name || !phoneNumber) {
      throw createHttpError(400, 'username, phoneNumber, and name are required for signup.');
    }
    return signupWithOtp({ username, name, phoneNumber, otp, deviceId });
  }

  if (!identifier) {
    throw createHttpError(400, 'identifier is required for login.');
  }
  return loginWithOtp({ identifier, otp, deviceId });
};

// ─── 4. Refresh Token Rotation ────────────────────────────────────────────────

export const refresh = async (rawRefreshToken: string, deviceId: string): Promise<TokenPair> => {
  return rotateRefreshToken(rawRefreshToken, deviceId);
};

// ─── 5. Logout ────────────────────────────────────────────────────────────────

export const logout = async (rawRefreshToken: string): Promise<void> => {
  return revokeRefreshToken(rawRefreshToken);
};

// ─── 6. Get Current User ─────────────────────────────────────────────────────

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
