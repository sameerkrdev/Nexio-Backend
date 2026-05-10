import { Router } from 'express';
import { verifyAccessTokenMiddleware } from '../middlewares/verifyAccessToken.middleware';
import {
  registerPushToken,
  unregisterPushToken,
  sendTestNotification,
} from '../controllers/notification.controller';

const notificationRouter = Router();

// All routes require authentication
notificationRouter.use(verifyAccessTokenMiddleware);

// Register push token
notificationRouter.post('/register-token', registerPushToken);

// Unregister push token
notificationRouter.post('/unregister-token', unregisterPushToken);

// Send test notification
notificationRouter.post('/test', sendTestNotification);

export default notificationRouter;
