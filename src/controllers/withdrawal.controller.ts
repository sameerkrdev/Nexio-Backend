import type { NextFunction, Response } from 'express';
import createHttpError from 'http-errors';
import type { AuthenticatedRequest } from '../types/auth.type';
import {
  cancelWithdrawal,
  DailyLimitExceededError,
  getAvailableMethods,
  getWithdrawalById,
  initiateWithdrawal,
  listWithdrawals,
} from '../services/withdrawal.service';
import type {
  CreateWithdrawalBody,
  WithdrawalIdParams,
  WithdrawalListQuery,
} from '../zodSchema/withdrawal.schema';

const toHttpError = (error: unknown) => {
  if (error instanceof DailyLimitExceededError) {
    return createHttpError(429, error.message);
  }
  return error;
};

export const getWithdrawalMethodsController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }
    const methods = await getAvailableMethods(req.user.userId);
    return res.status(200).json({
      success: true,
      data: methods,
    });
  } catch (error) {
    return next(toHttpError(error));
  }
};

export const createWithdrawalController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }
    const body = req.body as CreateWithdrawalBody;
    const withdrawal = await initiateWithdrawal({
      userId: req.user.userId,
      accountId: body.accountId,
      amount: body.amount,
      note: body.note,
    });

    return res.status(201).json({
      success: true,
      data: withdrawal,
    });
  } catch (error) {
    return next(toHttpError(error));
  }
};

export const listWithdrawalsController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }
    const query = req.query as unknown as WithdrawalListQuery;
    const result = await listWithdrawals({
      userId: req.user.userId,
      page: Number(query.page) || 1,
      limit: Number(query.limit) || 20,
      status: query.status,
    });
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    return next(toHttpError(error));
  }
};

export const getWithdrawalByIdController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }
    const params = req.params as WithdrawalIdParams;
    const result = await getWithdrawalById(req.user.userId, params.id);
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(toHttpError(error));
  }
};

export const cancelWithdrawalController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }
    const params = req.params as WithdrawalIdParams;
    const result = await cancelWithdrawal(req.user.userId, params.id);
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(toHttpError(error));
  }
};
