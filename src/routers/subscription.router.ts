import { Router } from 'express';
import {
  getMySubscriptionController,
  initSubscriptionCheckoutController,
  verifySubscriptionController,
} from '../controllers/subscription.controller';
import { verifyAccessTokenMiddleware } from '../middlewares/verifyAccessToken.middleware';

const subscriptionRouter = Router();

subscriptionRouter.get('/me', verifyAccessTokenMiddleware, getMySubscriptionController);

subscriptionRouter.post('/init', verifyAccessTokenMiddleware, initSubscriptionCheckoutController);

subscriptionRouter.post('/verify', verifyAccessTokenMiddleware, verifySubscriptionController);

export default subscriptionRouter;
