import type { NextFunction, Response } from 'express';
import createHttpError from 'http-errors';
import type { AuthenticatedRequest } from '../types/auth.type';
import prisma from '../config/prisma.config';
import env from '../config/dotenv.config';
import logger from '../config/logger.config';
import { createSubscription, getSubscription } from '../services/dodoPayment.service';
import { detectCountryFromPhone } from '../utils/countryDetect';

/**
 * GET /api/v1/subscriptions/me
 *
 * Returns the user's current subscription state. Premium is active iff
 * `subscriptionExpiresAt` is in the future.
 */
export const getMySubscriptionController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { subscriptionExpiresAt: true },
    });
    if (!user) throw createHttpError(404, 'User not found.');

    const now = new Date();
    const expires = user.subscriptionExpiresAt;
    const isActive = !!expires && expires.getTime() > now.getTime();

    return res.status(200).json({
      success: true,
      data: {
        isActive,
        expiresAt: expires?.toISOString() ?? null,
        plan: isActive ? 'premium' : 'free',
        price: env.SUBSCRIPTION_PRICE,
        currency: env.SUBSCRIPTION_CURRENCY,
        durationDays: env.SUBSCRIPTION_DURATION_DAYS,
      },
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /api/v1/subscriptions/verify
 *
 * Fallback path for when the user returns to the app before Dodo's
 * `subscription.active` webhook has fired (or if it fires at all). Pulls the
 * subscription from Dodo, and if it's active, activates the user locally.
 *
 * Safe to call repeatedly — it's idempotent (sets expiry to next_billing_date,
 * not "extends by 30 days").
 */
export const verifySubscriptionController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }
    const subscriptionId = (req.body as { subscriptionId?: unknown }).subscriptionId;
    if (typeof subscriptionId !== 'string' || subscriptionId.length === 0) {
      throw createHttpError(400, 'subscriptionId is required.');
    }

    const sub = await getSubscription(subscriptionId);
    // Only activate if the metadata.userId in Dodo matches the caller —
    // prevents one user from "verifying" another user's subscription_id.
    const metaUserId = sub.metadata.userId;
    if (metaUserId && metaUserId !== req.user.userId) {
      throw createHttpError(403, 'Subscription does not belong to this user.');
    }

    const isActive = sub.status === 'active' || sub.status === 'on_hold';
    let expiresAt: Date | null = null;

    if (isActive) {
      if (sub.nextBillingDate) {
        const parsed = new Date(sub.nextBillingDate);
        if (!Number.isNaN(parsed.getTime())) expiresAt = parsed;
      }
      if (!expiresAt) {
        expiresAt = new Date(Date.now() + env.SUBSCRIPTION_DURATION_DAYS * 24 * 60 * 60 * 1000);
      }
      await prisma.user.update({
        where: { id: req.user.userId },
        data: { subscriptionExpiresAt: expiresAt },
      });
      logger.info('[Subscription] verified + activated locally', {
        userId: req.user.userId,
        subscriptionId,
        status: sub.status,
        expiresAt: expiresAt.toISOString(),
      });
    } else {
      logger.info('[Subscription] verify: subscription not active', {
        userId: req.user.userId,
        subscriptionId,
        status: sub.status,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        status: sub.status,
        isActive,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /api/v1/subscriptions/init
 *
 * Opens a Dodo Payments hosted checkout for the subscription purchase.
 * On successful payment, Dodo fires payment.succeeded → webhook handler
 * sets user.subscriptionExpiresAt = now + SUBSCRIPTION_DURATION_DAYS.
 */
export const initSubscriptionCheckoutController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
      },
    });
    if (!user) throw createHttpError(404, 'User not found.');

    const email = user.email ?? `${user.phoneNumber.replace(/\D/g, '')}@users.nexapay.local`;
    const country = detectCountryFromPhone(user.phoneNumber);

    // After successful checkout Dodo redirects the user's browser to this URL.
    // The app's WebBrowser.openAuthSessionAsync watches for it and closes the
    // browser automatically, putting the user back in the app.
    const bodyReturnUrl = (req.body as { returnUrl?: unknown }).returnUrl;
    const returnUrl =
      typeof bodyReturnUrl === 'string' && bodyReturnUrl.length > 0
        ? bodyReturnUrl
        : 'myapp://subscription-success';

    const result = await createSubscription({
      productId: env.DODO_SUBSCRIPTION_PRODUCT_ID,
      country,
      customer: { email, name: user.name, phoneNumber: user.phoneNumber },
      metadata: {
        userId: user.id,
        purpose: 'subscription',
        durationDays: String(env.SUBSCRIPTION_DURATION_DAYS),
      },
      returnUrl,
    });

    logger.info('[Subscription] checkout initialized', {
      userId: user.id,
      subscriptionId: result.subscriptionId,
      paymentId: result.paymentId,
    });

    // Return the same shape the frontend already consumes (checkoutUrl + paymentId).
    // We add subscriptionId for completeness — client can ignore it if not needed.
    return res.status(201).json({
      success: true,
      data: {
        checkoutUrl: result.checkoutUrl,
        paymentId: result.paymentId,
        subscriptionId: result.subscriptionId,
        expiresAt: result.expiresAt,
        totalAmount: env.SUBSCRIPTION_PRICE,
      },
    });
  } catch (error) {
    return next(error);
  }
};
