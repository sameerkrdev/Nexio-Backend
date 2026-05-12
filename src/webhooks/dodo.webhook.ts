import crypto from 'crypto';
import type { Request, Response } from 'express';
import env from '../config/dotenv.config';
import logger from '../config/logger.config';
import prisma from '../config/prisma.config';
import { creditWallet } from '../services/wallet.service';

/**
 * Dodo Payments webhook receiver.
 *
 * Verifies signatures using the Standard Webhooks spec (which Dodo follows):
 *   - Headers: webhook-id, webhook-timestamp, webhook-signature
 *   - Signed string: `${webhook-id}.${webhook-timestamp}.${rawBody}`
 *   - Algorithm:   HMAC-SHA256(secret, signedString), base64-encoded
 *   - Header value format: `v1,<base64>` (space-separated tuples for key rotation)
 *
 * The signing secret is configured via env.DODO_WEBHOOK_KEY (fetched from
 * Dodo Dashboard → Developer → Webhooks → Secret Key). If the secret is
 * unset, verification fails closed (401) — we never accept unverified events.
 *
 * Currently Dodo Payments emits events for the collection side of their
 * platform (payment.succeeded, subscription.active, dispute.*, etc.) — none
 * of those map to a withdrawal in our flow, so this handler logs incoming
 * events and acknowledges them. When Dodo ships disbursement webhooks (or
 * we repurpose this endpoint for another provider), the switch in
 * `handleDodoEvent` is where the business logic plugs in.
 */
export const dodoWebhookHandler = async (req: Request, res: Response): Promise<Response> => {
  const webhookId = req.header('webhook-id');
  const timestamp = req.header('webhook-timestamp');
  const signatureHeader = req.header('webhook-signature');
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;

  // 1. Required headers
  if (!webhookId || !timestamp || !signatureHeader) {
    logger.warn('[Dodo] Webhook rejected — missing Standard-Webhooks headers', {
      hasId: !!webhookId,
      hasTimestamp: !!timestamp,
      hasSignature: !!signatureHeader,
    });
    return res.status(400).json({ success: false, message: 'Missing webhook headers' });
  }

  // 2. Raw body — must be the exact bytes Dodo signed
  if (!rawBody) {
    logger.error('[Dodo] Raw body unavailable — bodyParser.verify is not wired');
    return res.status(500).json({ success: false, message: 'Raw body unavailable' });
  }

  // 3. Timestamp tolerance (replay protection)
  const tsSeconds = Number(timestamp);
  if (!Number.isFinite(tsSeconds)) {
    return res.status(400).json({ success: false, message: 'Invalid webhook-timestamp' });
  }
  const ageSeconds = Math.abs(Date.now() / 1000 - tsSeconds);
  if (ageSeconds > env.DODO_WEBHOOK_TOLERANCE_SECONDS) {
    logger.warn('[Dodo] Webhook rejected — timestamp outside tolerance window', {
      webhookId,
      ageSeconds: Math.round(ageSeconds),
      toleranceSeconds: env.DODO_WEBHOOK_TOLERANCE_SECONDS,
    });
    return res.status(400).json({ success: false, message: 'Stale webhook timestamp' });
  }

  // 4. Signature verification — Standard Webhooks scheme
  if (!env.DODO_WEBHOOK_KEY) {
    logger.error('[Dodo] DODO_WEBHOOK_KEY is not set — refusing webhook');
    return res.status(401).json({ success: false, message: 'Webhook secret not configured' });
  }
  if (!isValidSignature(webhookId, timestamp, rawBody, signatureHeader, env.DODO_WEBHOOK_KEY)) {
    logger.warn('[Dodo] Webhook rejected — signature mismatch', { webhookId });
    return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
  }

  // 5. Parse + dispatch
  let event: { type?: string; data?: unknown };
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ success: false, message: 'Invalid JSON payload' });
  }

  logger.info('[Dodo] Webhook received', { webhookId, type: event.type });
  await handleDodoEvent(event);

  return res.status(200).json({ success: true });
};

/**
 * Standard Webhooks signature check.
 *
 * The signature header can carry multiple space-separated tuples like
 *   `v1,<base64sig1> v1,<base64sig2>`
 * to support key rotation. We accept the webhook if ANY tuple matches.
 */
const isValidSignature = (
  webhookId: string,
  timestamp: string,
  rawBody: Buffer,
  signatureHeader: string,
  secret: string,
): boolean => {
  const signedString = `${webhookId}.${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto
    .createHmac('sha256', deriveSecretBytes(secret))
    .update(signedString)
    .digest('base64');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const tuples = signatureHeader.split(' ').filter(Boolean);
  for (const tuple of tuples) {
    const idx = tuple.indexOf(',');
    if (idx === -1) continue;
    const version = tuple.slice(0, idx);
    const sig = tuple.slice(idx + 1);
    if (version !== 'v1') continue;
    const sigBuf = Buffer.from(sig, 'utf8');
    if (sigBuf.length !== expectedBuf.length) continue;
    if (crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
};

/**
 * Dodo's signing secrets in the dashboard are sometimes shown with a
 * `whsec_` prefix (Standard-Webhooks convention). The raw key bytes used
 * for HMAC are the base64-decoded value after the prefix; if the prefix
 * isn't there, we use the secret string as-is.
 */
const deriveSecretBytes = (secret: string): Buffer => {
  if (secret.startsWith('whsec_')) {
    try {
      return Buffer.from(secret.slice(6), 'base64');
    } catch {
      return Buffer.from(secret, 'utf8');
    }
  }
  return Buffer.from(secret, 'utf8');
};

/**
 * Event dispatcher. Dodo's catalog covers `payment.*`, `subscription.*`,
 * `dispute.*`, `refund.*`, `license_key.*`, etc. None of those drive our
 * withdrawal lifecycle today (their /payouts API is read-only merchant
 * settlements). We log and acknowledge so Dodo doesn't retry; future
 * disbursement events go here.
 */
const handleDodoEvent = async (event: { type?: string; data?: unknown }): Promise<void> => {
  switch (event.type) {
    case 'payment.succeeded':
      await handlePaymentSucceeded(event.data);
      return;
    case 'payment.failed':
      logger.info('[Dodo] payment.failed received', { data: event.data });
      return;
    case 'subscription.active':
    case 'subscription.renewed':
      // Both events extend the premium tier to the new next_billing_date.
      await handleSubscriptionLifecycle(event.data, event.type);
      return;
    case 'subscription.cancelled':
    case 'subscription.expired':
    case 'subscription.failed':
    case 'subscription.on_hold':
      // We let the existing subscriptionExpiresAt stand — the user keeps access
      // until their paid period runs out. Log for observability.
      logger.info('[Dodo] subscription lifecycle event', {
        type: event.type,
        data: event.data,
      });
      return;
    default:
      logger.info('[Dodo] Unhandled event type — acknowledged', { type: event.type });
      return;
  }
};

/**
 * payment.succeeded → credit the user's wallet for a top-up.
 *
 * Idempotent: creditWallet's referenceType+referenceId pair acts as a unique
 * key. Webhook retries with the same Dodo payment_id will return the existing
 * transaction instead of double-crediting.
 */
const handlePaymentSucceeded = async (data: unknown): Promise<void> => {
  const payload = data as {
    payment_id?: string;
    total_amount?: number;
    currency?: string;
    metadata?: Record<string, string>;
  };
  const paymentId = payload?.payment_id;
  const totalAmountLowest = payload?.total_amount;
  const metadata = payload?.metadata ?? {};

  if (!paymentId || typeof totalAmountLowest !== 'number') {
    logger.warn('[Dodo] payment.succeeded missing required fields', {
      hasPaymentId: !!paymentId,
      hasTotalAmount: typeof totalAmountLowest === 'number',
    });
    return;
  }

  // Only wallet top-ups are credited here. Subscription payments come through
  // separate `subscription.*` events (handled by handleSubscriptionLifecycle).
  if (metadata.purpose !== 'wallet_topup') {
    logger.info('[Dodo] payment.succeeded ignored — unknown purpose', {
      paymentId,
      purpose: metadata.purpose,
    });
    return;
  }

  const userId = metadata.userId;
  if (!userId) {
    logger.error('[Dodo] payment.succeeded for wallet_topup is missing userId in metadata', {
      paymentId,
    });
    return;
  }

  const currency = (metadata.currency ?? payload.currency ?? 'INR').toUpperCase();
  // Dodo sends totals in the lowest denomination (paise/cents). Convert back
  // for our wallet (which stores 2-decimal currency strings).
  const wholeUnits = currency === 'JPY' ? totalAmountLowest : totalAmountLowest / 100;
  const amountStr = wholeUnits.toFixed(currency === 'JPY' ? 0 : 2);

  await prisma.$transaction(async (tx) => {
    await creditWallet(
      {
        userId,
        amount: amountStr,
        reason: 'admin_credit',
        title: 'Wallet top-up',
        description: 'Top-up via Dodo Payments',
        referenceType: 'dodo_topup',
        referenceId: paymentId,
        metadata: { source: 'dodo', dodoPaymentId: paymentId },
      },
      tx,
    );
  });

  logger.info('[Dodo] Wallet credited from top-up', {
    userId,
    paymentId,
    amount: amountStr,
    currency,
  });
};

/**
 * subscription.active (first activation) and subscription.renewed (each
 * renewal cycle) both extend the user's premium tier to the new
 * `next_billing_date` from Dodo. We trust Dodo's date — it's authoritative
 * for the current billing period.
 *
 * If `next_billing_date` is absent for any reason, fall back to
 * env.SUBSCRIPTION_DURATION_DAYS from now (worst case: user gets a small
 * grace period instead of being kicked off).
 */
const handleSubscriptionLifecycle = async (data: unknown, eventType: string): Promise<void> => {
  const payload = data as {
    subscription_id?: string;
    status?: string;
    next_billing_date?: string;
    metadata?: Record<string, string>;
  };
  const subscriptionId = payload?.subscription_id;
  const metadata = payload?.metadata ?? {};
  const userId = metadata.userId;

  if (!userId) {
    logger.error('[Dodo] subscription event missing userId in metadata', {
      eventType,
      subscriptionId,
    });
    return;
  }

  // Compute new expiry: prefer Dodo's authoritative next_billing_date,
  // fall back to env-configured duration from now.
  let newExpiresAt: Date;
  if (payload.next_billing_date) {
    const parsed = new Date(payload.next_billing_date);
    newExpiresAt = Number.isNaN(parsed.getTime())
      ? new Date(Date.now() + env.SUBSCRIPTION_DURATION_DAYS * 24 * 60 * 60 * 1000)
      : parsed;
  } else {
    newExpiresAt = new Date(Date.now() + env.SUBSCRIPTION_DURATION_DAYS * 24 * 60 * 60 * 1000);
  }

  const updated = await prisma.user
    .update({
      where: { id: userId },
      data: { subscriptionExpiresAt: newExpiresAt },
      select: { id: true },
    })
    .catch((error) => {
      logger.error('[Dodo] subscription user.update failed', {
        userId,
        subscriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });

  if (!updated) return;

  logger.info('[Dodo] Subscription activated', {
    eventType,
    userId,
    subscriptionId,
    newExpiresAt: newExpiresAt.toISOString(),
    status: payload.status,
  });
};
