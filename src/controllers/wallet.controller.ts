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
    const result = await listWalletTransactions(req.user.userId, {
      page: query.page,
      limit: query.limit,
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
