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
          cryptoType: params.payment.cryptoType,
          cryptoAmount: params.payment.cryptoAmount,
          platformFeeAmount: params.payment.platformFeeAmount,
          platformFeeCrypto: params.payment.platformFeeCrypto,
          totalCryptoAmount: params.payment.totalCryptoAmount,
          senderCurrency: params.payment.senderCurrency,
          senderCurrencyAmount: params.payment.senderCurrencyAmount,
          receiverCurrency: params.payment.receiverCurrency,
          receiverCurrencyAmount: params.payment.receiverCurrencyAmount,
          cryptoToSenderRate: params.payment.cryptoToSenderRate,
          senderToReceiverRate: params.payment.senderToReceiverRate,
          platformFeePercent: params.payment.platformFeePercent,
          rateSource: params.payment.rateSource,
          rateSnapshotAt: params.payment.rateSnapshotAt,
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
  // Helius can send the secret in 'helius-auth-token' or standard 'authorization' header
  const token = req.header('helius-auth-token') || req.header('authorization');

  console.log(' ---------- TOKEN ---------', token);

  if (!token) return false;

  // Handle 'Bearer <token>' if present
  const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;

  const provided = Buffer.from(cleanToken, 'utf8');
  const secret = Buffer.from(env.HELIUS_WEBHOOK_SECRET, 'utf8');

  // console.log('PROVIDED:', provided);
  // console.log('SECRET:', secret);

  if (provided.length !== secret.length) return false;
  return crypto.timingSafeEqual(provided, secret);
};

export const heliusWebhookHandler = async (req: Request, res: Response): Promise<Response> => {
  console.log('\n🔔 ========= HELIUS WEBHOOK RECEIVED =========');
  logger.info('Helius webhook received', { body: req.body });

  console.log('📦 HELIUS RAW BODY:', JSON.stringify(req.body, null, 2));

  if (!isAuthorizedWebhook(req)) {
    console.log('❌ WEBHOOK AUTH FAILED');
    logger.warn('Helius webhook auth failed', {
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });
    return res.status(401).json({ success: false, message: 'Unauthorized webhook request' });
  }

  console.log('✅ WEBHOOK AUTH PASSED');

  try {
    const nexioWallet = getNexioPublicKey().toBase58();
    console.log('🏦 Nexio Wallet:', nexioWallet);

    const transactions = parseHeliusPayload(req.body);
    console.log(`📝 Parsed ${transactions.length} transaction(s)`);

    for (const tx of transactions) {
      console.log('\n--- Processing Transaction ---');
      console.log('🔑 Signature:', tx.signature);

      let memo = parseMemoFromHeliusPayload(tx.instructions);
      console.log('📋 Memo from payload:', memo);

      if (!memo) {
        console.log('⚠️  No memo in payload, fetching from RPC...');
        const rawTx = await withRpcRetry((conn) =>
          conn.getParsedTransaction(tx.signature, 'confirmed'),
        );
        if (rawTx) {
          memo = parseMemoFromRawTransaction(rawTx);
          console.log('📋 Memo from RPC:', memo);
        }
      }

      logger.info('Webhook transaction received', {
        signature: tx.signature,
        memo,
      });

      if (!memo) {
        console.log('❌ No memo found, skipping transaction');
        continue;
      }

      console.log('🔍 Looking up payment with ID:', memo);
      const payment = await prisma.payment.findUnique({
        where: { id: memo },
      });

      console.log('💳 Payment found:', payment ? 'YES' : 'NO');
      if (payment) {
        console.log('   - Status:', payment.status);
        console.log('   - TxHash:', payment.txHash);
        console.log('   - Amount:', payment.totalCryptoAmount, payment.cryptoType);
      }

      if (!payment || payment.txHash) {
        console.log('⏭️  Skipping:', !payment ? 'payment_not_found' : 'payment_already_processed');
        logger.info('Webhook skipped', {
          signature: tx.signature,
          memo,
          skipped: !payment ? 'payment_not_found' : 'payment_already_processed',
        });
        continue;
      }

      if (payment.status === PaymentStatus.completed) {
        console.log('⏭️  Payment already completed, skipping');
        continue;
      }

      if (payment.expiresAt < new Date()) {
        console.log('⏰ Payment expired, marking as failed');
        await markPaymentFailed({
          paymentId: payment.id,
          signature: tx.signature,
          failureReason: 'payment_expired',
        });
        continue;
      }

      console.log('🔐 Validating payment transfer...');
      const result = validatePaymentTransfer({
        tx,
        cryptoType: payment.cryptoType,
        expectedTotalAmount: String(payment.totalCryptoAmount),
        nexioWallet,
      });

      if (!result.ok) {
        console.log('❌ VALIDATION FAILED:', result.reason);
        await markPaymentFailed({
          paymentId: payment.id,
          signature: tx.signature,
          failureReason: result.reason ?? 'transfer_validation_failed',
        });
        continue;
      }

      console.log('✅ VALIDATION PASSED - Marking payment as completed');
      await markPaymentCompleted({
        payment,
        signature: tx.signature,
      });

      console.log('🎉 PAYMENT COMPLETED SUCCESSFULLY');
      logger.info('Payment status changed', {
        paymentId: payment.id,
        userId: payment.senderId,
        oldStatus: payment.status,
        newStatus: PaymentStatus.completed,
      });
    }

    console.log('✅ Webhook processing complete\n');
    return res.status(200).json({ success: true });
  } catch (error) {
    console.log('💥 WEBHOOK ERROR:', error);
    logger.error('Helius webhook processing failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(200).json({ success: true });
  }
};

export { connection };
