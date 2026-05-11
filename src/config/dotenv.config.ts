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

  TWILIO_ACCOUNT_SID: str({ default: '' }),
  TWILIO_AUTH_TOKEN: str({ default: '' }),
  TWILIO_PHONE_NUMBER: str({ default: '' }),

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

  // Jupiter
  JUPITER_API_URL: str({ default: 'https://api.jup.ag/swap/v2' }),
  JUPITER_PRICE_API_URL: str({ default: 'https://api.jup.ag/price/v3' }),
  JUPITER_API_KEY: str({ default: '' }),

  // Treasury swap behavior
  NEXIO_PRIVATE_KEY: str({ default: '' }),
  SWAP_ENABLED: bool({ default: false }),
  SWAP_SLIPPAGE_BPS: str({ default: '' }),
  SWAP_BATCH_INTERVAL_MINUTES: num({ default: 30 }),
  SWAP_MIN_AMOUNT_USD: num({ default: 5 }),
  SWAP_MAX_RETRIES: num({ default: 3 }),

  // Payment behavior
  ACCEPT_OVERPAYMENT: bool({ default: true }),
  PLATFORM_FEE_PERCENT: num({ default: 1.5 }),
  QUOTE_EXPIRES_IN_SECONDS: num({ default: 30 }),
  PAYMENT_EXPIRES_IN_MINUTES: num({ default: 5 }),
  FIAT_RATE_API_URL: str({ default: 'https://api.frankfurter.app' }),
  FIAT_RATE_API_KEY: str({ default: '' }),
  PLATFORM_USER_ID: str({ default: '00000000-0000-0000-0000-000000000001' }),

  // Wallet encryption
  WALLET_ENCRYPTION_KEY: str(),

  // Withdrawal fees
  WITHDRAWAL_FEE_IMPS: num({ default: 5 }),
  WITHDRAWAL_FEE_NEFT: num({ default: 5 }),
  WITHDRAWAL_FEE_ACH_PERCENT: num({ default: 0.25 }),
  WITHDRAWAL_FEE_ACH_MIN: num({ default: 0.25 }),
  WITHDRAWAL_FEE_WIRE: num({ default: 20 }),
  WITHDRAWAL_FEE_SEPA: num({ default: 0.5 }),
  WITHDRAWAL_FEE_SEPA_INSTANT_PERCENT: num({ default: 0.5 }),
  WITHDRAWAL_FEE_ZENGIN: num({ default: 150 }),
  WITHDRAWAL_FEE_INTERAC: num({ default: 1.5 }),

  // Withdrawal daily limits
  WITHDRAWAL_DAILY_LIMIT_INR: num({ default: 100000 }),
  WITHDRAWAL_DAILY_LIMIT_USD: num({ default: 1000 }),
  WITHDRAWAL_DAILY_LIMIT_EUR: num({ default: 1000 }),
  WITHDRAWAL_DAILY_LIMIT_GBP: num({ default: 800 }),
  WITHDRAWAL_DAILY_LIMIT_JPY: num({ default: 150000 }),
  WITHDRAWAL_DAILY_LIMIT_SGD: num({ default: 1500 }),
  WITHDRAWAL_DAILY_LIMIT_AUD: num({ default: 1500 }),
  WITHDRAWAL_DAILY_LIMIT_CAD: num({ default: 1500 }),
  WITHDRAWAL_WORKER_INTERVAL_MS: num({ default: 15000 }),
});

export default env;
