import { PublicKey } from '@solana/web3.js';
import env from './dotenv.config';

export type TokenSymbol = 'SOL' | 'USDT' | 'USDC' | 'LINK';

export interface TokenConfig {
  symbol: TokenSymbol;
  decimals: number;
  mint: PublicKey | null;
}

const createMint = (mint: string, symbol: string): PublicKey => {
  try {
    return new PublicKey(mint);
  } catch {
    throw new Error(`Invalid ${symbol} mint address`);
  }
};

export const TOKENS: Record<TokenSymbol, TokenConfig> = {
  SOL: {
    symbol: 'SOL',
    decimals: 9,
    mint: null,
  },
  USDT: {
    symbol: 'USDT',
    decimals: 6,
    mint: createMint(env.USDT_MINT_ADDRESS, 'USDT'),
  },
  USDC: {
    symbol: 'USDC',
    decimals: 6,
    mint: createMint(env.USDC_MINT_ADDRESS, 'USDC'),
  },
  LINK: {
    symbol: 'LINK',
    // Chainlink CCIP directory: Solana LINK uses 9 on-chain decimals (not EVM’s 18).
    decimals: 9,
    mint: createMint(env.LINK_MINT_ADDRESS, 'LINK'),
  },
};
