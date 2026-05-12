import { Router } from 'express';
import { heliusWebhookHandler } from '../webhooks/helius.webhook';
import { dodoWebhookHandler } from '../webhooks/dodo.webhook';

const webhookRouter = Router();

webhookRouter.post('/helius', heliusWebhookHandler);
webhookRouter.post('/dodo', dodoWebhookHandler);

export default webhookRouter;
