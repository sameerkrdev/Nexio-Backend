import logger from './logger.config';
import env from './dotenv.config';
import { TOKENS } from './tokens';
import { getNexioAtaStatus } from '../services/transaction.service';
import { getNexioKeypair, getNexioPublicKey, withRpcRetry } from '../utils/solana';

const validateUrl = (value: string, name: string) => {
  try {
    new URL(value);
  } catch {
    throw new Error(`Invalid ${name}`);
  }
};

const validateSwapConfig = () => {
  if (env.SWAP_BATCH_INTERVAL_MINUTES <= 0) {
    throw new Error('SWAP_BATCH_INTERVAL_MINUTES must be greater than 0');
  }
  if (env.SWAP_MIN_AMOUNT_USD < 0) {
    throw new Error('SWAP_MIN_AMOUNT_USD must be greater than or equal to 0');
  }
  if (!Number.isInteger(env.SWAP_MAX_RETRIES) || env.SWAP_MAX_RETRIES < 0) {
    throw new Error('SWAP_MAX_RETRIES must be a non-negative integer');
  }

  const slippage = env.SWAP_SLIPPAGE_BPS.trim();
  if (slippage) {
    const parsed = Number(slippage);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) {
      throw new Error('SWAP_SLIPPAGE_BPS must be an integer between 0 and 10000');
    }
  }
};

const validateJupiterReachable = async () => {
  const response = await fetch(`${env.JUPITER_PRICE_API_URL}?ids=${TOKENS.USDC.mint?.toBase58()}`, {
    headers: env.JUPITER_API_KEY ? { 'x-api-key': env.JUPITER_API_KEY } : undefined,
  });
  if (response.status >= 500) {
    throw new Error(`Jupiter API unavailable: ${response.status}`);
  }
};

export const validateStartupConfig = async () => {
  // Touch required config values early so startup fails fast.
  void env.HELIUS_API_KEY;
  void env.HELIUS_RPC_URL;
  void env.HELIUS_WEBHOOK_SECRET;
  void env.NEXIO_WALLET;
  void TOKENS.USDT.mint;
  void TOKENS.USDC.mint;
  void TOKENS.LINK.mint;
  getNexioPublicKey();
  validateUrl(env.JUPITER_API_URL, 'JUPITER_API_URL');
  validateUrl(env.JUPITER_PRICE_API_URL, 'JUPITER_PRICE_API_URL');
  validateSwapConfig();
  if (env.SWAP_ENABLED) {
    getNexioKeypair();
    await validateJupiterReachable();
  }

  await withRpcRetry((conn) => conn.getSlot('confirmed'));

  const ataStatus = await getNexioAtaStatus();
  if (!ataStatus.USDT || !ataStatus.USDC || !ataStatus.LINK) {
    logger.warn('Nexio token ATA missing', ataStatus);
  }

  logger.info('Treasury swap configuration loaded', {
    enabled: env.SWAP_ENABLED,
    intervalMinutes: env.SWAP_BATCH_INTERVAL_MINUTES,
    slippageBps: env.SWAP_SLIPPAGE_BPS || 'rtse',
    minAmountUsd: env.SWAP_MIN_AMOUNT_USD,
    maxRetries: env.SWAP_MAX_RETRIES,
  });
};
