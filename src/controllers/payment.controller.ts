import type { NextFunction, Response } from 'express';
import createHttpError from 'http-errors';
import type { AuthenticatedRequest } from '../types/auth.type';
import {
  cancelPayment,
  createPayment,
  getPaymentQuote,
  getPaymentById,
  paymentHistory,
} from '../services/payment.service';
import type {
  CreatePaymentBody,
  PaymentHistoryQuery,
  PaymentIdParams,
  PaymentQuoteQuery,
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
      recipientType: body.recipientType,
      recipientUsername: body.recipientType === 'platform' ? body.recipientUsername : undefined,
      receiverPhone: body.recipientType === 'external' ? body.receiverPhone : undefined,
      receiverPaymentMethod:
        body.recipientType === 'external' ? body.receiverPaymentMethod : undefined,
      receiverPaymentDetails:
        body.recipientType === 'external' ? body.receiverPaymentDetails : undefined,
      cryptoType: body.cryptoType,
      cryptoAmount: body.cryptoAmount,
      platformFeeAmount: body.platformFeeAmount,
      platformFeeCrypto: body.platformFeeCrypto,
      totalCryptoAmount: body.totalCryptoAmount,
      senderCurrency: body.senderCurrency,
      senderCurrencyAmount: body.senderCurrencyAmount,
      receiverCurrency: body.receiverCurrency,
      receiverCurrencyAmount: body.receiverCurrencyAmount,
      cryptoToSenderRate: body.cryptoToSenderRate,
      senderToReceiverRate: body.senderToReceiverRate,
      platformFeePercent: body.platformFeePercent,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
};

export const getPaymentQuoteController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }
    const query = req.query as unknown as PaymentQuoteQuery;
    const result = await getPaymentQuote({
      senderId: req.user.userId,
      receiverUsername: query.receiverUsername,
      receiverPhone: query.receiverPhone,
      cryptoType: query.crypto,
      senderCurrency: query.senderCurrency,
    });
    return res.status(200).json({ success: true, data: result });
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
    // console.log('================', req.user);
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }

    const query = req.query as unknown as PaymentHistoryQuery;
    const result = await paymentHistory({
      userId: req.user.userId,
      page: Number(query.page) || 1,
      limit: Number(query.limit) || 20,
      status: query.status,
    });

    // console.log(result);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return next(err);
  }
};
