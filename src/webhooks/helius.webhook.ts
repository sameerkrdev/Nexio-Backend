import crypto from 'crypto';
import type { Request, Response } from 'express';
import { PaymentStatus, type Payment } from '../generated/prisma/client';
import env from '../config/dotenv.config';
import logger from '../config/logger.config';
import prisma from '../config/prisma.config';
import { parseMemoFromHeliusPayload, parseMemoFromRawTransaction } from '../utils/memo';
import { connection, getNexioPublicKey, withRpcRetry } from '../utils/solana';
import { parseHeliusPayload, validatePaymentTransfer } from '../services/verification.service';
import { convertAndCredit } from '../services/wallet.service';

const updateCursor = async (signature: string) => {
  await prisma.webhookCursor.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', lastSignature: signature },
    update: { lastSignature: signature },
  });
};

const markPaymentFailed = async (params: {
  paymentId: string;
  signature: string;
  failureReason: string;
}) => {
  const result = await prisma.$transaction(async (tx) => {
    const existingByTxHash = await tx.payment.findUnique({
      where: { txHash: params.signature },
      select: { id: true },
    });
    if (existingByTxHash) return false;

    const updated = await tx.payment.updateMany({
      where: { id: params.paymentId, txHash: null },
      data: {
        status: PaymentStatus.failed,
        failureReason: params.failureReason,
        txHash: params.signature,
      },
    });
    return updated.count > 0;
  });

  if (result) {
    await updateCursor(params.signature);
  }
  return result;
};

const markPaymentCompleted = async (params: { payment: Payment; signature: string }) => {
  const result = await prisma.$transaction(async (tx) => {
    const existingByTxHash = await tx.payment.findUnique({
      where: { txHash: params.signature },
      select: { id: true },
    });
    if (existingByTxHash) return false;

    const updated = await tx.payment.updateMany({
      where: { id: params.payment.id, txHash: null },
      data: {
        status: PaymentStatus.completed,
        txHash: params.signature,
        completedAt: new Date(),
        failureReason: null,
      },
    });
    if (updated.count === 0) return false;

    try {
      await convertAndCredit(
        params.payment.recipientUserId,
        {
          id: params.payment.id,
          amount: params.payment.amount,
          currency: params.payment.currency,
          feeBreakdown: params.payment.feeBreakdown,
          senderId: params.payment.senderId,
          senderPublicKey: params.payment.senderPublicKey,
          recipientUsername: params.payment.recipientUsername,
        },
        tx,
      );
    } catch (error) {
      logger.error('Wallet credit failed after confirmed payment', {
        paymentId: params.payment.id,
        recipientUserId: params.payment.recipientUserId,
        signature: params.signature,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return true;
  });

  if (result) {
    await updateCursor(params.signature);
  }
  return result;
};

const isAuthorizedWebhook = (req: Request): boolean => {
  const tokenHeader = req.header('helius-auth-token');
  if (!tokenHeader) return false;

  const provided = Buffer.from(tokenHeader, 'utf8');
  const secret = Buffer.from(env.HELIUS_WEBHOOK_SECRET, 'utf8');

  if (provided.length !== secret.length) return false;
  return crypto.timingSafeEqual(provided, secret);
};

export const heliusWebhookHandler = async (req: Request, res: Response): Promise<Response> => {
  if (!isAuthorizedWebhook(req)) {
    logger.warn('Helius webhook auth failed', {
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });
    return res.status(401).json({ success: false, message: 'Unauthorized webhook request' });
  }

  try {
    const nexioWallet = getNexioPublicKey().toBase58();
    const transactions = parseHeliusPayload(req.body);

    for (const tx of transactions) {
      let memo = parseMemoFromHeliusPayload(tx.instructions);

      if (!memo) {
        const rawTx = await withRpcRetry((conn) =>
          conn.getParsedTransaction(tx.signature, 'confirmed'),
        );
        if (rawTx) {
          memo = parseMemoFromRawTransaction(rawTx);
        }
      }

      logger.info('Webhook transaction received', {
        signature: tx.signature,
        memo,
      });

      if (!memo) continue;

      const payment = await prisma.payment.findUnique({
        where: { id: memo },
      });

      if (!payment || payment.txHash) {
        logger.info('Webhook skipped', {
          signature: tx.signature,
          memo,
          skipped: !payment ? 'payment_not_found' : 'payment_already_processed',
        });
        continue;
      }

      if (payment.status === PaymentStatus.completed) {
        continue;
      }

      if (payment.expiresAt < new Date()) {
        await markPaymentFailed({
          paymentId: payment.id,
          signature: tx.signature,
          failureReason: 'payment_expired',
        });
        continue;
      }

      const result = validatePaymentTransfer({
        tx,
        currency: payment.currency,
        expectedTotalAmount: String(payment.totalAmount ?? payment.amount),
        nexioWallet,
      });

      if (!result.ok) {
        await markPaymentFailed({
          paymentId: payment.id,
          signature: tx.signature,
          failureReason: result.reason ?? 'transfer_validation_failed',
        });
        continue;
      }

      await markPaymentCompleted({
        payment,
        signature: tx.signature,
      });

      logger.info('Payment status changed', {
        paymentId: payment.id,
        userId: payment.senderId,
        oldStatus: payment.status,
        newStatus: PaymentStatus.completed,
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Helius webhook processing failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(200).json({ success: true });
  }
};

export { connection };
