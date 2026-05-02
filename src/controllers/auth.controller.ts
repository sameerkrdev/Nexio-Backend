import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from '../types/auth.type';
import type {
  CheckUsernameBody,
  SendOtpBody,
  VerifyOtpBody,
  RefreshTokenBody,
  LogoutBody,
} from '../zodSchema/auth.schema.ts';
import * as authService from '../services/auth.service';

// ─── 1. Check Username ────────────────────────────────────────────────────────

export const checkUsername = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { username } = req.body as CheckUsernameBody;
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
    const { phoneNumber, purpose, username, identifier } = req.body as SendOtpBody;

    await authService.sendOtp({ phoneNumber, purpose, username, identifier });

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
    const { phoneNumber, otp, purpose, username, name, identifier } = req.body as VerifyOtpBody;

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
      identifier,
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
    const { refreshToken: rawRefreshToken, deviceId } = req.body as RefreshTokenBody;

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
    const { refreshToken: rawRefreshToken } = req.body as LogoutBody;
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
