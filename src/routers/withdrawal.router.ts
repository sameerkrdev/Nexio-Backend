import { Router } from 'express';
import {
  cancelWithdrawalController,
  createWithdrawalController,
  getWithdrawalByIdController,
  getWithdrawalMethodsController,
  listWithdrawalsController,
} from '../controllers/withdrawal.controller';
import { withdrawalCreateRateLimit } from '../middlewares/rateLimit';
import { verifyAccessTokenMiddleware } from '../middlewares/verifyAccessToken.middleware';
import zodValidatorMiddleware from '../middlewares/zodValidator.middleware';
import {
  createWithdrawalSchema,
  withdrawalIdParamSchema,
  withdrawalListQuerySchema,
} from '../zodSchema/withdrawal.schema';

const withdrawalRouter = Router();

withdrawalRouter.get('/methods', verifyAccessTokenMiddleware, getWithdrawalMethodsController);

withdrawalRouter.post(
  '/',
  verifyAccessTokenMiddleware,
  withdrawalCreateRateLimit,
  zodValidatorMiddleware(createWithdrawalSchema),
  createWithdrawalController,
);

withdrawalRouter.get(
  '/',
  verifyAccessTokenMiddleware,
  zodValidatorMiddleware(withdrawalListQuerySchema),
  listWithdrawalsController,
);

withdrawalRouter.get(
  '/:id',
  verifyAccessTokenMiddleware,
  zodValidatorMiddleware(withdrawalIdParamSchema),
  getWithdrawalByIdController,
);

withdrawalRouter.post(
  '/:id/cancel',
  verifyAccessTokenMiddleware,
  zodValidatorMiddleware(withdrawalIdParamSchema),
  cancelWithdrawalController,
);

export default withdrawalRouter;
