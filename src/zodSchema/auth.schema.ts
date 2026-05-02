import { z } from 'zod';

// ─── Reusable field validators ────────────────────────────────────────────────

const usernameField = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(30, 'Username must be at most 30 characters')
  .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers, and underscores');

const phoneNumberField = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, 'Phone number must be in E.164 format (e.g. +919876543210)');

const otpField = z
  .string()
  .length(6, 'OTP must be exactly 6 digits')
  .regex(/^\d{6}$/, 'OTP must contain only digits');

// ─── 1. Check Username ────────────────────────────────────────────────────────

export const checkUsernameSchema = z.object({
  body: z.object({
    username: usernameField,
  }),
});

export type CheckUsernameBody = z.infer<typeof checkUsernameSchema>['body'];

// ─── 2. Send OTP ──────────────────────────────────────────────────────────────

export const sendOtpSchema = z.object({
  body: z.object({
    phoneNumber: phoneNumberField,
    purpose: z.enum(['signup', 'login']),
  }),
});

export type SendOtpBody = z.infer<typeof sendOtpSchema>['body'];

// ─── 3. Verify OTP ───────────────────────────────────────────────────────────

export const verifyOtpSchema = z.object({
  body: z
    .object({
      phoneNumber: phoneNumberField,
      otp: otpField,
      purpose: z.enum(['signup', 'login']),
      // Signup-only fields
      username: usernameField.optional(),
      name: z.string().min(1, 'Name is required').max(100).optional(),
    })
    .refine(
      (data) => {
        if (data.purpose === 'signup') {
          return data.username !== undefined && data.name !== undefined;
        }
        return true;
      },
      {
        message: 'username and name are required for signup',
        path: ['username'],
      },
    ),
});

export type VerifyOtpBody = z.infer<typeof verifyOtpSchema>['body'];

// ─── 4. Refresh Token ─────────────────────────────────────────────────────────

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
    deviceId: z.string().min(1, 'Device ID is required'),
  }),
});

export type RefreshTokenBody = z.infer<typeof refreshTokenSchema>['body'];

// ─── 5. Logout ────────────────────────────────────────────────────────────────

export const logoutSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
  }),
});

export type LogoutBody = z.infer<typeof logoutSchema>['body'];
