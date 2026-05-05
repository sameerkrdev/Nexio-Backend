import { bool, cleanEnv, num, port, str } from 'envalid';

const env = cleanEnv(process.env, {
  NODE_ENV: str({
    choices: ['development', 'production', 'test'],
    default: 'development',
  }),

  PORT: port({ default: 3000 }),

  LOG_LEVEL: str({ default: 'info' }),

  DATABASE_URL: str(),
  POSTGRES_DATABASE_URL: str({
    requiredWhen() {
      if (process.env.NODE_ENV === 'development') {
        return true;
      }
      return false;
    },
  }),

  REDIS_URL: str(),

  JWT_PRIVATE_KEY: str(),
  JWT_PUBLIC_KEY: str(),
  JWT_ACCESS_EXPIRY: str({ default: '15m' }),
  JWT_REFRESH_EXPIRY_DAYS: str({ default: '30' }),

  TWILIO_ACCOUNT_SID: str(),
  TWILIO_AUTH_TOKEN: str(),
  TWILIO_PHONE_NUMBER: str(),

  // Helius + Solana
  HELIUS_API_KEY: str(),
  HELIUS_RPC_URL: str(),
  HELIUS_DEVNET_RPC_URL: str(),
  HELIUS_WEBHOOK_SECRET: str(),
  SOLANA_NETWORK: str({
    choices: ['mainnet', 'devnet'],
    default: 'mainnet',
  }),
  NEXIO_WALLET: str(),

  // Token mints
  USDT_MINT_ADDRESS: str(),
  USDC_MINT_ADDRESS: str(),
  LINK_MINT_ADDRESS: str(),

  // Payment behavior
  SERVICE_FEE_PERCENT: num({ default: 0.5 }),
  ACCEPT_OVERPAYMENT: bool({ default: true }),
  TX_EXPIRY_MINUTES: num({ default: 10 }),
});

export default env;
