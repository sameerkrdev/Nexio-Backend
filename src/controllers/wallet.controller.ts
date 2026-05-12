import type { NextFunction, Response } from 'express';
import createHttpError from 'http-errors';
import type { AuthenticatedRequest } from '../types/auth.type';
import {
  getBalance,
  getWalletTransactionById,
  listWalletTransactions,
} from '../services/wallet.service';
import type {
  WalletTransactionListQuery,
  WalletTransactionParams,
} from '../zodSchema/wallet.schema';
import prisma from '../config/prisma.config';
import { createTopUpPayment } from '../services/dodoPayment.service';
import { detectCountryFromPhone } from '../utils/countryDetect';

const serializeBalance = (snapshot: Awaited<ReturnType<typeof getBalance>>) => ({
  balance: snapshot.balance.toString(),
  reservedBalance: snapshot.reservedBalance.toString(),
  available: snapshot.available.toString(),
  currency: snapshot.currency,
  status: snapshot.status,
});

export const getMyWalletController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }
    const snapshot = await getBalance(req.user.userId);
    return res.status(200).json({ success: true, data: serializeBalance(snapshot) });
  } catch (error) {
    return next(error);
  }
};

export const listWalletTransactionsController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }
    const query = req.query as unknown as WalletTransactionListQuery;
    console.log('==========QUERYYYYYYY+++++++++++', query.from, query.to);
    const result = await listWalletTransactions(req.user.userId, {
      page: Number(query.page) || 1,
      limit: Number(query.limit) || 20,
      type: query.type,
      reason: query.reason,
      from: query.from,
      to: query.to,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /api/v1/wallet/top-up
 *
 * Minimal proof of Dodo Checkout integration. Creates a Dodo one-time payment
 * and returns the hosted-checkout URL the client should open. The actual
 * wallet credit happens later in the dodo webhook handler when Dodo fires
 * `payment.succeeded` (not implemented in this proof — separate follow-up).
 *
 * Body: { amount: number, currency?: string, returnUrl?: string }
 * Returns: { checkoutUrl: string, paymentId: string, expiresAt: string | null }
 */
export const createWalletTopUpController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }
    const body = req.body as { amount?: unknown; currency?: unknown; returnUrl?: unknown };
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw createHttpError(400, 'amount must be a positive number.');
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        wallet: { select: { currency: true } },
      },
    });
    if (!user) {
      throw createHttpError(404, 'User not found.');
    }
    // Dodo's POST /payments requires an email — we synthesize one if the user
    // hasn't given us one (their phone is the unique identifier in our app).
    const email = user.email ?? `${user.phoneNumber.replace(/\D/g, '')}@users.nexapay.local`;

    const currency =
      typeof body.currency === 'string' && body.currency.length === 3
        ? body.currency.toUpperCase()
        : (user.wallet?.currency ?? 'INR');
    const country = detectCountryFromPhone(user.phoneNumber);

    const result = await createTopUpPayment({
      amount,
      currency,
      country,
      customer: { email, name: user.name, phoneNumber: user.phoneNumber },
      // Echoed back to us on the payment.succeeded webhook so we can credit
      // the right user's wallet.
      metadata: {
        userId: user.id,
        purpose: 'wallet_topup',
        currency,
      },
      returnUrl: typeof body.returnUrl === 'string' ? body.returnUrl : undefined,
    });

    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
};

export const getWalletTransactionByIdController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }
    const { id } = req.params as WalletTransactionParams;
    const transaction = await getWalletTransactionById(req.user.userId, id);
    return res.status(200).json({ success: true, data: transaction });
  } catch (error) {
    return next(error);
  }
};
