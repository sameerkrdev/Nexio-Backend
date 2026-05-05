import express from 'express';
import bodyParser from 'body-parser';
import { errorHandler } from './middlewares/errorHandler.middleware';
import authRouter from './routers/auth.route';
import userRouter from './routers/user.route';
import paymentRouter from './routers/payment.route';
import webhookRouter from './routers/webhook.route';
import { requestLoggerMiddleware } from './middlewares/requestLogger.middleware';

const app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(requestLoggerMiddleware);

// Health check
app.get('/', (_req, res) => {
  res.json({ success: true, message: 'Nexio API is running' });
});

// Auth routes
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1/payments', paymentRouter);
app.use('/api/v1/webhooks', webhookRouter);

// Centralized error handler — must be last
app.use(errorHandler);

export default app;
