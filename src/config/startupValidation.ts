import logger from './logger.config';
import env from './dotenv.config';
import { TOKENS } from './tokens';
import { getNexioAtaStatus } from '../services/transaction.service';
import { getNexioPublicKey, withRpcRetry } from '../utils/solana';

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

  await withRpcRetry((conn) => conn.getSlot('confirmed'));

  const ataStatus = await getNexioAtaStatus();
  if (!ataStatus.USDT || !ataStatus.USDC || !ataStatus.LINK) {
    logger.warn('Nexio token ATA missing', ataStatus);
  }
};
