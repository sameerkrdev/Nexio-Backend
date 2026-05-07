import type { NextFunction, Response } from 'express';
import createHttpError from 'http-errors';
import type { AuthenticatedRequest } from '../types/auth.type';
import {
  addAccount,
  listAccounts,
  removeAccount,
  setDefaultAccount,
} from '../services/withdrawalAccount.service';
import type {
  CreateWithdrawalAccountBody,
  WithdrawalAccountIdParams,
} from '../zodSchema/withdrawalAccount.schema';

const extractDetails = (body: CreateWithdrawalAccountBody): Record<string, unknown> => {
  const { method, nickname, ...details } = body;
  void method;
  void nickname;
  return details;
};

export const addWithdrawalAccountController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }
    const body = req.body as CreateWithdrawalAccountBody;
    const account = await addAccount({
      userId: req.user.userId,
      method: body.method,
      nickname: body.nickname,
      details: extractDetails(body),
    });

    return res.status(201).json({
      success: true,
      data: account,
    });
  } catch (error) {
    return next(error);
  }
};

export const listWithdrawalAccountsController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }
    const accounts = await listAccounts(req.user.userId);
    return res.status(200).json({
      success: true,
      accounts,
    });
  } catch (error) {
    return next(error);
  }
};

export const setDefaultWithdrawalAccountController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }
    const params = req.params as WithdrawalAccountIdParams;
    const account = await setDefaultAccount(req.user.userId, params.id);
    return res.status(200).json({
      success: true,
      data: account,
    });
  } catch (error) {
    return next(error);
  }
};

export const removeWithdrawalAccountController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }
    const params = req.params as WithdrawalAccountIdParams;
    await removeAccount(req.user.userId, params.id);
    return res.status(200).json({
      success: true,
      message: 'Withdrawal account removed',
    });
  } catch (error) {
    return next(error);
  }
};
