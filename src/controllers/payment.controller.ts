import type { NextFunction, Response } from 'express';
import createHttpError from 'http-errors';
import type { AuthenticatedRequest } from '../types/auth.type';
import {
  cancelPayment,
  createPayment,
  getPaymentById,
  paymentHistory,
} from '../services/payment.service';
import type {
  CreatePaymentBody,
  PaymentHistoryQuery,
  PaymentIdParams,
} from '../zodSchema/payment.schema';

export const createPaymentController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }
    const body = req.body as CreatePaymentBody;
    const result = await createPayment({
      userId: req.user.userId,
      recipientUsername: body.recipientUsername,
      amount: body.amount,
      currency: body.currency,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
};

export const getPaymentController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params as PaymentIdParams;
    const result = await getPaymentById(id);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
};

export const cancelPaymentController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }
    const { id } = req.params as PaymentIdParams;
    const result = await cancelPayment(id, req.user.userId);
    return res.status(200).json({
      success: true,
      message: 'Payment cancelled. Webhook can still mark it completed if transaction arrives.',
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

export const paymentHistoryController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }

    const query = req.query as unknown as PaymentHistoryQuery;
    const result = await paymentHistory({
      userId: req.user.userId,
      page: query.page,
      limit: query.limit,
      status: query.status,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return next(err);
  }
};
