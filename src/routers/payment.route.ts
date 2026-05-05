import { Router } from 'express';
import {
  cancelPaymentController,
  createPaymentController,
  getPaymentController,
  paymentHistoryController,
} from '../controllers/payment.controller';
import { verifyAccessTokenMiddleware } from '../middlewares/verifyAccessToken.middleware';
import zodValidatorMiddleware from '../middlewares/zodValidator.middleware';
import {
  createPaymentSchema,
  paymentHistorySchema,
  paymentIdParamSchema,
} from '../zodSchema/payment.schema';
import { paymentCreateRateLimit } from '../middlewares/rateLimit';

const paymentRouter = Router();

paymentRouter.post(
  '/create',
  verifyAccessTokenMiddleware,
  paymentCreateRateLimit,
  zodValidatorMiddleware(createPaymentSchema),
  createPaymentController,
);

paymentRouter.get(
  '/history',
  verifyAccessTokenMiddleware,
  zodValidatorMiddleware(paymentHistorySchema),
  paymentHistoryController,
);

paymentRouter.get(
  '/:id',
  verifyAccessTokenMiddleware,
  zodValidatorMiddleware(paymentIdParamSchema),
  getPaymentController,
);

paymentRouter.post(
  '/:id/cancel',
  verifyAccessTokenMiddleware,
  zodValidatorMiddleware(paymentIdParamSchema),
  cancelPaymentController,
);

export default paymentRouter;
