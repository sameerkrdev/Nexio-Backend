import { Router } from 'express';
import {
  addWithdrawalAccountController,
  listWithdrawalAccountsController,
  removeWithdrawalAccountController,
  setDefaultWithdrawalAccountController,
} from '../controllers/withdrawalAccount.controller';
import { withdrawalAccountCreateRateLimit } from '../middlewares/rateLimit';
import { verifyAccessTokenMiddleware } from '../middlewares/verifyAccessToken.middleware';
import zodValidatorMiddleware from '../middlewares/zodValidator.middleware';
import {
  createWithdrawalAccountSchema,
  withdrawalAccountIdParamSchema,
} from '../zodSchema/withdrawalAccount.schema';

const withdrawalAccountRouter = Router();

withdrawalAccountRouter.post(
  '/',
  verifyAccessTokenMiddleware,
  withdrawalAccountCreateRateLimit,
  zodValidatorMiddleware(createWithdrawalAccountSchema),
  addWithdrawalAccountController,
);

withdrawalAccountRouter.get('/', verifyAccessTokenMiddleware, listWithdrawalAccountsController);

withdrawalAccountRouter.patch(
  '/:id/default',
  verifyAccessTokenMiddleware,
  zodValidatorMiddleware(withdrawalAccountIdParamSchema),
  setDefaultWithdrawalAccountController,
);

withdrawalAccountRouter.delete(
  '/:id',
  verifyAccessTokenMiddleware,
  zodValidatorMiddleware(withdrawalAccountIdParamSchema),
  removeWithdrawalAccountController,
);

export default withdrawalAccountRouter;
