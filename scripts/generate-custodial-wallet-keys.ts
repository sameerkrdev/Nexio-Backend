import { Keypair } from '@solana/web3.js';

// function generateCustodialWalletKeys(): Keypair {
const custodialWallet = Keypair.generate();
console.log('Custodial wallet:', custodialWallet.publicKey.toBase58());
console.log('Custodial wallet private key:', custodialWallet.secretKey);
//   return custodialWallet;
// }

// export default generateCustodialWalletKeys;
