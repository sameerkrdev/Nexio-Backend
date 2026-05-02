import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from '../types/auth.type';
import * as authService from '../services/auth.service';

// ─── 1. Check Username ────────────────────────────────────────────────────────

export const checkUsername = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { username } = req.body as { username: string };
    const result = await authService.checkUsername(username);

    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

// ─── 2. Send OTP ──────────────────────────────────────────────────────────────

export const sendOtp = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { phoneNumber, purpose, username } = req.body as {
      phoneNumber: string;
      purpose: 'signup' | 'login';
      username?: string;
    };

    await authService.sendOtp(phoneNumber, purpose, username);

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully.',
    });
  } catch (err) {
    next(err);
  }
};

// ─── 3. Verify OTP ────────────────────────────────────────────────────────────

export const verifyOtp = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { phoneNumber, otp, purpose, username, name } = req.body as {
      phoneNumber: string;
      otp: string;
      purpose: 'signup' | 'login';
      username?: string;
      name?: string;
    };

    // deviceId is sent as a header for mobile clients; fall back to body
    const deviceId =
      (req.headers['x-device-id'] as string | undefined) ??
      (req.body as { deviceId?: string }).deviceId ??
      'unknown';

    const tokens = await authService.verifyOtp({
      phoneNumber,
      otp,
      purpose,
      deviceId,
      username,
      name,
    });

    res.status(200).json({
      success: true,
      message: purpose === 'signup' ? 'Account created successfully.' : 'Login successful.',
      data: tokens,
    });
  } catch (err) {
    next(err);
  }
};

// ─── 4. Refresh Token ─────────────────────────────────────────────────────────

export const refreshToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { refreshToken: rawRefreshToken, deviceId } = req.body as {
      refreshToken: string;
      deviceId: string;
    };

    const tokens = await authService.refresh(rawRefreshToken, deviceId);

    res.status(200).json({ success: true, data: tokens });
  } catch (err) {
    next(err);
  }
};

// ─── 5. Logout ────────────────────────────────────────────────────────────────

export const logout = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { refreshToken: rawRefreshToken } = req.body as { refreshToken: string };
    await authService.logout(rawRefreshToken);

    res.status(200).json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    next(err);
  }
};

// ─── 6. Get Current User ─────────────────────────────────────────────────────

export const getMe = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const user = await authService.getMe(userId);

    res.status(200).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};
