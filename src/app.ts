import express from 'express';
import bodyParser from 'body-parser';
import { errorHandler } from './middlewares/errorHandler.middleware';
import authRouter from './routers/auth.route';

const app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Health check
app.get('/', (_req, res) => {
  res.json({ success: true, message: 'Nexio API is running' });
});

// Auth routes
app.use('/api/v1/auth', authRouter);

// Centralized error handler — must be last
app.use(errorHandler);

export default app;
