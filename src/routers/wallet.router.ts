import { Router } from 'express';
import {
  createWalletTopUpController,
  getMyWalletController,
  getWalletTransactionByIdController,
  listWalletTransactionsController,
} from '../controllers/wallet.controller';
import { verifyAccessTokenMiddleware } from '../middlewares/verifyAccessToken.middleware';
import zodValidatorMiddleware from '../middlewares/zodValidator.middleware';
import {
  walletTransactionListQuerySchema,
  walletTransactionParamsSchema,
} from '../zodSchema/wallet.schema';

const walletRouter = Router();

walletRouter.get('/me', verifyAccessTokenMiddleware, getMyWalletController);

walletRouter.post('/top-up', verifyAccessTokenMiddleware, createWalletTopUpController);

walletRouter.get(
  '/transactions',
  verifyAccessTokenMiddleware,
  zodValidatorMiddleware(walletTransactionListQuerySchema),
  listWalletTransactionsController,
);

walletRouter.get(
  '/transactions/:id',
  verifyAccessTokenMiddleware,
  zodValidatorMiddleware(walletTransactionParamsSchema),
  getWalletTransactionByIdController,
);

export default walletRouter;
