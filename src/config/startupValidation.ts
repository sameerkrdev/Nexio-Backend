import logger from './logger.config';
import env from './dotenv.config';
import { TOKENS } from './tokens';
import { getNexioAtaStatus } from '../services/transaction.service';
import { getNexioKeypair, getNexioPublicKey, withRpcRetry } from '../utils/solana';
import { validateWalletEncryptionSetup } from '../utils/encryption';

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
  void env.WALLET_ENCRYPTION_KEY;
  validateWalletEncryptionSetup();
  getNexioPublicKey();
  validateUrl(env.JUPITER_API_URL, 'JUPITER_API_URL');
  validateUrl(env.JUPITER_PRICE_API_URL, 'JUPITER_PRICE_API_URL');
  validateSwapConfig();

  // Dodo Payments config — log what we see at boot so missing env vars are
  // obvious before the first /wallet/top-up or /withdrawals/dodo-init request.
  const maskedDodoKey = env.DODO_API_KEY
    ? `${env.DODO_API_KEY.slice(0, 4)}…${env.DODO_API_KEY.slice(-4)}`
    : '<unset>';
  logger.info('[Dodo] startup config', {
    apiKey: maskedDodoKey,
    baseUrl: env.DODO_API_BASE_URL,
    topupProductId: env.DODO_TOPUP_PRODUCT_ID || '<unset>',
    webhookKeySet: Boolean(env.DODO_WEBHOOK_KEY),
  });
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

  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) {
    logger.warn('Twilio configuration missing. SMS notifications are disabled.');
  }
};
