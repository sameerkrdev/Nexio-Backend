import { Router } from 'express';
import { heliusWebhookHandler } from '../webhooks/helius.webhook';

const webhookRouter = Router();

webhookRouter.post('/helius', heliusWebhookHandler);

export default webhookRouter;
