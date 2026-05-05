import { PublicKey } from '@solana/web3.js';
import { connection } from '../src/utils/solana';
import env from '../src/config/dotenv.config';

const secretKey = process.env.NEXIO_PRIVATE_KEY;
if (!secretKey) {
  throw new Error('NEXIO_PRIVATE_KEY is required for ATA setup script');
}

const nexioPublicKey = new PublicKey(env.NEXIO_WALLET);

async function addDevnetFunds(amount: number): Promise<void> {
  await connection.requestAirdrop(nexioPublicKey, amount * 1e9); // 1 SOL
  console.log(`Funds added: ${nexioPublicKey}`);
}

void addDevnetFunds(1).catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
