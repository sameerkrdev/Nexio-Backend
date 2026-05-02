import { Router } from 'express';
import zodValidatorMiddleware from '../middlewares/zodValidator.middleware';
import { verifyAccessTokenMiddleware } from '../middlewares/verifyAccessToken.middleware';
import {
  checkUsernameSchema,
  sendOtpSchema,
  verifyOtpSchema,
  refreshTokenSchema,
  logoutSchema,
} from '../zodSchema/auth.schema';
import * as authController from '../controllers/auth.controller';

const router = Router();

/**
 * POST /api/v1/auth/check-username
 * Check if a username is available (used for debounced real-time validation)
 */
router.post(
  '/check-username',
  zodValidatorMiddleware(checkUsernameSchema),
  authController.checkUsername,
);

/**
 * POST /api/v1/auth/send-otp
 * Send OTP to the given phone number; rate-limited via Redis
 * Body: { phoneNumber, purpose: "signup"|"login", username? }
 */
router.post('/send-otp', zodValidatorMiddleware(sendOtpSchema), authController.sendOtp);

/**
 * POST /api/v1/auth/verify-otp
 * Verify OTP and either create a new account (signup) or log in (login)
 * Returns: { accessToken, refreshToken }
 */
router.post('/verify-otp', zodValidatorMiddleware(verifyOtpSchema), authController.verifyOtp);

/**
 * POST /api/v1/auth/refresh
 * Rotate a refresh token — returns a new token pair
 * Body: { refreshToken, deviceId }
 */
router.post('/refresh', zodValidatorMiddleware(refreshTokenSchema), authController.refreshToken);

/**
 * POST /api/v1/auth/logout
 * Revoke the given refresh token
 * Body: { refreshToken }
 */
router.post('/logout', zodValidatorMiddleware(logoutSchema), authController.logout);

/**
 * GET /api/v1/auth/me
 * Protected — returns current authenticated user's profile
 */
router.get('/me', verifyAccessTokenMiddleware, authController.getMe);

export default router;
