import type { Request } from 'express';

// ─── JWT Payload ──────────────────────────────────────────────────────────────

export interface JwtPayload {
  userId: string;
  username: string;
  iat?: number;
  exp?: number;
}

// ─── Authenticated Request ────────────────────────────────────────────────────

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

// ─── Token Pair ───────────────────────────────────────────────────────────────

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// ─── OTP Redis Hash ───────────────────────────────────────────────────────────

export interface OtpData {
  otp: string;
  expiry: string; // unix ms timestamp as string
  used: string; // "true" | "false"
}
