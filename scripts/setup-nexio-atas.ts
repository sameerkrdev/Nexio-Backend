import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import env from '../src/config/dotenv.config';
import { TOKENS } from '../src/config/tokens';
import { connection } from '../src/utils/solana';

const secretKey = process.env.NEXIO_PRIVATE_KEY;
if (!secretKey) {
  throw new Error('NEXIO_PRIVATE_KEY is required for ATA setup script');
}

const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secretKey) as number[]));
const nexio = new PublicKey(env.NEXIO_WALLET);

const ensureAta = async (symbol: 'USDT' | 'USDC' | 'LINK') => {
  const mint = TOKENS[symbol].mint;
  if (!mint) throw new Error(`Missing ${symbol} mint`);

  const ata = getAssociatedTokenAddressSync(mint, nexio, false);
  const info = await connection.getAccountInfo(ata);
  if (info) {
    console.log(`${symbol} ATA already exists: ${ata.toBase58()}`);
    return;
  }

  const balance = await connection.getBalance(payer.publicKey);

  if (balance === 0) {
    throw new Error('Payer has no SOL. Fund the wallet first.');
  }

  const tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(payer.publicKey, ata, nexio, mint),
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: 'confirmed',
  });
  console.log(`${symbol} ATA created: ${ata.toBase58()} (${sig})`);
};

const main = async () => {
  await ensureAta('USDT');
  await ensureAta('USDC');
  await ensureAta('LINK');
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
