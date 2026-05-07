import { getAssociatedTokenAddressSync, NATIVE_MINT } from '@solana/spl-token';
import { VersionedTransaction } from '@solana/web3.js';
import Decimal from 'decimal.js';
import { Currency, SwapStatus } from '../generated/prisma/client';
import env from '../config/dotenv.config';
import logger from '../config/logger.config';
import prisma from '../config/prisma.config';
import { TOKENS } from '../config/tokens';
import { getNexioKeypair, getNexioPublicKey, withRpcRetry } from '../utils/solana';
import { fromTokenUnits } from '../utils/amount';
import { executeOrder, getOrder, getPrices, type JupiterOrderResponse } from '../utils/jupiter';

const SWAP_CURRENCIES = [Currency.SOL, Currency.USDT, Currency.LINK] as const;
const SOL_FEE_BUFFER_LAMPORTS = 1_000_000n;
const SOL_FEE_BUFFER_DECIMAL = new Decimal('0.001');

interface MerchantBalance {
  balanceDecimal: Decimal;
  balanceUnits: bigint;
}

interface SwapDecision {
  shouldSwap: boolean;
  estimatedUsd: Decimal;
}

interface ExecuteBatchParams {
  currency: Currency;
  balanceDecimal: Decimal;
  balanceUnits: bigint;
  existingBatchId?: string;
}

const decimalFromUnits = (units: bigint, decimals: number) =>
  new Decimal(units.toString()).div(new Decimal(10).pow(decimals));

const normalizeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const getTokenConfig = (currency: Currency) => {
  const token = TOKENS[currency];
  if (currency !== Currency.SOL && !token.mint) {
    throw new Error(`Missing mint for ${currency}`);
  }
  return token;
};

const getInputMint = (currency: Currency): string => {
  if (currency === Currency.SOL) return NATIVE_MINT.toBase58();
  const mint = getTokenConfig(currency).mint;
  if (!mint) throw new Error(`Missing mint for ${currency}`);
  return mint.toBase58();
};

const getSwapSlippageBps = (): number | undefined => {
  const raw = env.SWAP_SLIPPAGE_BPS.trim();
  if (!raw) return undefined;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) {
    throw new Error('SWAP_SLIPPAGE_BPS must be an integer between 0 and 10000');
  }
  return parsed;
};

const getOutputUsdcMint = (): string => {
  const usdcMint = TOKENS.USDC.mint;
  if (!usdcMint) throw new Error('Missing USDC mint');
  return usdcMint.toBase58();
};

const createSkippedBatch = async (
  currency: Currency,
  balanceDecimal: Decimal,
  failureReason: string,
) => {
  await prisma.swapBatch.create({
    data: {
      currency,
      fromAmount: balanceDecimal,
      status: SwapStatus.skipped,
      failureReason,
      completedAt: new Date(),
    },
  });
};

const setBatchFailed = async (batchId: string, error: unknown, txHash?: string) => {
  const failureReason = normalizeError(error);
  await prisma.swapBatch.update({
    where: { id: batchId },
    data: {
      status: SwapStatus.failed,
      failureReason,
      txHash,
      attempts: { increment: 1 },
    },
  });
};

const completeBatch = async (
  batchId: string,
  txHash: string,
  toAmount: Decimal,
  quoteResponse: JupiterOrderResponse,
) => {
  try {
    await prisma.swapBatch.update({
      where: { id: batchId },
      data: {
        status: SwapStatus.completed,
        txHash,
        toAmount,
        quoteResponse,
        failureReason: null,
        completedAt: new Date(),
      },
    });
  } catch (error) {
    const existing = await prisma.swapBatch.findUnique({ where: { txHash } });
    if (existing) {
      await prisma.swapBatch.update({
        where: { id: existing.id },
        data: {
          status: SwapStatus.completed,
          toAmount,
          quoteResponse,
          failureReason: null,
          completedAt: new Date(),
        },
      });
      return;
    }
    throw error;
  }
};

export const getMerchantOnChainBalance = async (currency: Currency): Promise<MerchantBalance> => {
  const merchant = getNexioPublicKey();

  if (currency === Currency.SOL) {
    const lamports = BigInt(await withRpcRetry((conn) => conn.getBalance(merchant, 'confirmed')));
    const swappableLamports =
      lamports > SOL_FEE_BUFFER_LAMPORTS ? lamports - SOL_FEE_BUFFER_LAMPORTS : 0n;
    const balanceDecimal = decimalFromUnits(swappableLamports, TOKENS.SOL.decimals);

    logger.info('Swap balance check complete', {
      currency,
      onChainBalance: decimalFromUnits(lamports, TOKENS.SOL.decimals).toString(),
      swappableBalance: balanceDecimal.toString(),
      feeBufferMet: lamports > SOL_FEE_BUFFER_LAMPORTS,
    });

    return {
      balanceDecimal,
      balanceUnits: swappableLamports,
    };
  }

  const solLamports = BigInt(await withRpcRetry((conn) => conn.getBalance(merchant, 'confirmed')));
  if (solLamports < SOL_FEE_BUFFER_LAMPORTS) {
    logger.error('Merchant has insufficient SOL for swap fees', {
      currency,
      solBalance: decimalFromUnits(solLamports, TOKENS.SOL.decimals).toString(),
      requiredBuffer: SOL_FEE_BUFFER_DECIMAL.toString(),
    });
    return { balanceDecimal: new Decimal(0), balanceUnits: 0n };
  }

  const token = getTokenConfig(currency);
  const mint = token.mint;
  if (!mint) throw new Error(`Missing mint for ${currency}`);

  const ata = getAssociatedTokenAddressSync(mint, merchant, false);
  const accountInfo = await withRpcRetry((conn) => conn.getAccountInfo(ata, 'confirmed'));
  if (!accountInfo) {
    logger.warn('Merchant token ATA missing for swap balance check', {
      currency,
      ata: ata.toBase58(),
    });
    return { balanceDecimal: new Decimal(0), balanceUnits: 0n };
  }

  const balance = await withRpcRetry((conn) => conn.getTokenAccountBalance(ata, 'confirmed'));
  const amount = BigInt(balance.value.amount);
  const balanceDecimal = decimalFromUnits(amount, token.decimals);

  logger.info('Swap balance check complete', {
    currency,
    onChainBalance: balanceDecimal.toString(),
    ata: ata.toBase58(),
    feeBufferMet: true,
  });

  return {
    balanceDecimal,
    balanceUnits: amount,
  };
};

export const isBatchWorthSwapping = async (
  balanceDecimal: Decimal,
  currency: Currency,
): Promise<SwapDecision> => {
  let estimatedUsd: Decimal;

  if (currency === Currency.USDT) {
    estimatedUsd = balanceDecimal;
  } else {
    const price = await getPrices([getInputMint(currency)]);
    const usdPrice = price[getInputMint(currency)]?.usdPrice;
    if (usdPrice === undefined || usdPrice === null) {
      logger.warn('Jupiter price missing for swap threshold check', { currency });
      return { shouldSwap: false, estimatedUsd: new Decimal(0) };
    }
    estimatedUsd = balanceDecimal.mul(new Decimal(String(usdPrice)));
  }

  const minAmountUsd = new Decimal(env.SWAP_MIN_AMOUNT_USD);
  const shouldSwap = estimatedUsd.greaterThanOrEqualTo(minAmountUsd);
  logger.info('Swap worthiness check complete', {
    currency,
    onChainBalance: balanceDecimal.toString(),
    estimatedUsd: estimatedUsd.toString(),
    minAmountUsd: minAmountUsd.toString(),
    shouldSwap,
  });

  return { shouldSwap, estimatedUsd };
};

export const createAndExecuteBatch = async (params: ExecuteBatchParams) => {
  const batch = params.existingBatchId
    ? await prisma.swapBatch.update({
        where: { id: params.existingBatchId },
        data: {
          currency: params.currency,
          fromAmount: params.balanceDecimal,
          status: SwapStatus.in_progress,
          failureReason: null,
          completedAt: null,
        },
      })
    : await prisma.swapBatch.create({
        data: {
          currency: params.currency,
          fromAmount: params.balanceDecimal,
          status: SwapStatus.in_progress,
        },
      });

  try {
    const order = await getOrder({
      inputMint: getInputMint(params.currency),
      outputMint: getOutputUsdcMint(),
      amount: params.balanceUnits.toString(),
      taker: getNexioPublicKey().toBase58(),
      slippageBps: getSwapSlippageBps(),
    });

    await prisma.swapBatch.update({
      where: { id: batch.id },
      data: { quoteResponse: order },
    });

    logger.info('Swap order ready', {
      batchId: batch.id,
      currency: params.currency,
      inputMint: order.inputMint,
      inAmount: order.inAmount,
      expectedOutAmount: order.outAmount,
      router: order.router,
      mode: order.mode,
    });

    const transaction = VersionedTransaction.deserialize(Buffer.from(order.transaction!, 'base64'));
    transaction.sign([getNexioKeypair()]);
    const signedTransaction = Buffer.from(transaction.serialize()).toString('base64');

    const result = await executeOrder({
      signedTransaction,
      requestId: order.requestId!,
      lastValidBlockHeight: order.lastValidBlockHeight,
    });

    if (result.status !== 'Success') {
      const error = new Error(
        `Jupiter execute failed: code=${result.code ?? 'unknown'} error=${result.error ?? 'unknown'}`,
      );
      await setBatchFailed(batch.id, error, result.signature);
      logger.error('Swap failed', {
        batchId: batch.id,
        currency: params.currency,
        txHash: result.signature,
        error: error.message,
        attemptNumber: batch.attempts + 1,
      });
      return { batchId: batch.id, status: SwapStatus.failed };
    }

    if (!result.signature) {
      throw new Error('Jupiter execute succeeded without signature');
    }

    const outputUnits = BigInt(result.outputAmountResult ?? order.outAmount ?? '0');
    const toAmount = new Decimal(fromTokenUnits(outputUnits, TOKENS.USDC.decimals));

    await completeBatch(batch.id, result.signature, toAmount, order);
    logger.info('Swap confirmed', {
      batchId: batch.id,
      txHash: result.signature,
      toAmount: toAmount.toString(),
    });

    return { batchId: batch.id, status: SwapStatus.completed, txHash: result.signature };
  } catch (error) {
    logger.error('Swap failed', {
      batchId: batch.id,
      currency: params.currency,
      error: normalizeError(error),
      attemptNumber: batch.attempts + 1,
    });
    await setBatchFailed(batch.id, error);
    return { batchId: batch.id, status: SwapStatus.failed };
  }
};

export const runSwapBatchForAllTokens = async () => {
  if (!env.SWAP_ENABLED) {
    logger.info('Swap worker skipped because swaps are disabled');
    return;
  }

  for (const currency of SWAP_CURRENCIES) {
    const activeBatch = await prisma.swapBatch.findFirst({
      where: {
        currency,
        OR: [
          { status: SwapStatus.in_progress },
          { status: SwapStatus.pending },
          { status: SwapStatus.failed, attempts: { lt: env.SWAP_MAX_RETRIES } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    if (activeBatch) {
      logger.info('Swap worker skipped currency because a retryable batch exists', {
        currency,
        batchId: activeBatch.id,
        status: activeBatch.status,
      });
      continue;
    }

    const balance = await getMerchantOnChainBalance(currency);
    if (balance.balanceUnits === 0n) {
      logger.info('Swap worker skipped zero balance', { currency });
      continue;
    }

    const decision = await isBatchWorthSwapping(balance.balanceDecimal, currency);
    if (!decision.shouldSwap) {
      await createSkippedBatch(
        currency,
        balance.balanceDecimal,
        `on_chain_balance_below_${env.SWAP_MIN_AMOUNT_USD}_usd`,
      );
      logger.info('Swap worker skipped below minimum USD threshold', {
        currency,
        onChainBalance: balance.balanceDecimal.toString(),
        estimatedUsd: decision.estimatedUsd.toString(),
      });
      continue;
    }

    await createAndExecuteBatch({
      currency,
      balanceDecimal: balance.balanceDecimal,
      balanceUnits: balance.balanceUnits,
    });
  }
};

export const runRetryableSwapBatches = async () => {
  const batches = await prisma.swapBatch.findMany({
    where: {
      OR: [
        { status: SwapStatus.pending },
        { status: SwapStatus.failed, attempts: { lt: env.SWAP_MAX_RETRIES } },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });

  for (const batch of batches) {
    const balance = await getMerchantOnChainBalance(batch.currency);
    if (balance.balanceUnits === 0n) {
      await prisma.swapBatch.update({
        where: { id: batch.id },
        data: {
          status: SwapStatus.skipped,
          failureReason: 'on_chain_balance_zero',
          completedAt: new Date(),
        },
      });
      continue;
    }

    const decision = await isBatchWorthSwapping(balance.balanceDecimal, batch.currency);
    if (!decision.shouldSwap) {
      await prisma.swapBatch.update({
        where: { id: batch.id },
        data: {
          status: SwapStatus.skipped,
          fromAmount: balance.balanceDecimal,
          failureReason: `on_chain_balance_below_${env.SWAP_MIN_AMOUNT_USD}_usd`,
          completedAt: new Date(),
        },
      });
      continue;
    }

    await createAndExecuteBatch({
      currency: batch.currency,
      balanceDecimal: balance.balanceDecimal,
      balanceUnits: balance.balanceUnits,
      existingBatchId: batch.id,
    });
  }

  const exhausted = await prisma.swapBatch.findMany({
    where: {
      status: SwapStatus.failed,
      attempts: { gte: env.SWAP_MAX_RETRIES },
    },
  });

  exhausted.forEach((batch) => {
    logger.error('Swap batch exhausted retries - manual intervention required', {
      batchId: batch.id,
      currency: batch.currency,
      attempts: batch.attempts,
    });
  });
};

export const recoverStaleSwapBatches = async () => {
  const result = await prisma.swapBatch.updateMany({
    where: { status: SwapStatus.in_progress },
    data: { status: SwapStatus.pending },
  });

  logger.info('Recovered stale in_progress swap batches on startup', {
    count: result.count,
  });
};
