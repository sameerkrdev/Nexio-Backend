import { Connection, PublicKey } from '@solana/web3.js';
import type { Commitment } from '@solana/web3.js';
import env from '../config/dotenv.config';
import { withRetry } from './backoff';

const rpcUrl = env.SOLANA_NETWORK === 'devnet' ? env.HELIUS_DEVNET_RPC_URL : env.HELIUS_RPC_URL;

if (!rpcUrl) {
  throw new Error('Missing Helius RPC URL configuration');
}

export const connection = new Connection(rpcUrl, 'confirmed');

export const getNexioPublicKey = (): PublicKey => {
  return new PublicKey(env.NEXIO_WALLET);
};

export const withRpcRetry = async <T>(
  fn: (conn: Connection) => Promise<T>,
  commitment: Commitment = 'confirmed',
): Promise<T> => {
  void commitment;
  return withRetry(() => fn(connection));
};
