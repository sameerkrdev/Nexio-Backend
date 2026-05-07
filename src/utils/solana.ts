import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import type { Commitment } from '@solana/web3.js';
import env from '../config/dotenv.config';
import { withRetry } from './backoff';

const rpcUrl = env.SOLANA_NETWORK === 'devnet' ? env.HELIUS_DEVNET_RPC_URL : env.HELIUS_RPC_URL;

if (!rpcUrl) {
  throw new Error('Missing Helius RPC URL configuration');
}

export const connection = new Connection(rpcUrl, 'confirmed');
let cachedNexioKeypair: Keypair | null = null;

export const getNexioPublicKey = (): PublicKey => {
  return new PublicKey(env.NEXIO_WALLET);
};

export const getNexioKeypair = (): Keypair => {
  if (cachedNexioKeypair) return cachedNexioKeypair;
  if (!env.NEXIO_PRIVATE_KEY) {
    throw new Error('Missing NEXIO_PRIVATE_KEY configuration');
  }

  try {
    const keypair = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(env.NEXIO_PRIVATE_KEY) as number[]),
    );
    const expectedPublicKey = getNexioPublicKey().toBase58();
    if (keypair.publicKey.toBase58() !== expectedPublicKey) {
      throw new Error('NEXIO_PRIVATE_KEY does not match NEXIO_WALLET');
    }

    cachedNexioKeypair = keypair;
    return cachedNexioKeypair;
  } catch (error) {
    if (error instanceof Error && error.message.includes('does not match')) {
      throw error;
    }
    throw new Error('Invalid NEXIO_PRIVATE_KEY configuration', { cause: error });
  }
};

export const withRpcRetry = async <T>(
  fn: (conn: Connection) => Promise<T>,
  commitment: Commitment = 'confirmed',
): Promise<T> => {
  void commitment;
  return withRetry(() => fn(connection));
};
