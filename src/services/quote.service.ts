import Decimal from 'decimal.js';
import env from '../config/dotenv.config';
import { TOKENS, type TokenSymbol } from '../config/tokens';
import { withRetry } from '../utils/backoff';

const COINGECKO_IDS: Record<TokenSymbol, string> = {
  SOL: 'solana',
  USDT: 'tether',
  USDC: 'usd-coin',
  LINK: 'chainlink',
};

type RateSource = 'jupiter' | 'coingecko';

const parseDecimal = (value: string | number) => new Decimal(String(value));

const ensureToken = (cryptoType: string): TokenSymbol => {
  const normalized = cryptoType.toUpperCase() as TokenSymbol;
  if (!(normalized in TOKENS)) {
    throw new Error(`Unsupported cryptoType: ${cryptoType}`);
  }
  return normalized;
};

const fetchJupiterRate = async (cryptoType: TokenSymbol): Promise<Decimal> => {
  const response = await fetch(`https://api.jup.ag/price/v2?ids=${cryptoType}`);
  if (!response.ok) {
    throw new Error(`Jupiter unavailable: ${response.status}`);
  }
  const json = (await response.json()) as { data?: Record<string, { price?: number | string }> };
  const raw = json.data?.[cryptoType]?.price;
  if (raw === undefined || raw === null) {
    throw new Error('Jupiter response missing price');
  }
  return parseDecimal(raw);
};

const fetchCoingeckoCryptoRate = async (
  cryptoType: TokenSymbol,
  fiatCurrency: string,
): Promise<Decimal> => {
  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${COINGECKO_IDS[cryptoType]}&vs_currencies=${fiatCurrency.toLowerCase()}`,
  );
  if (!response.ok) {
    throw new Error(`CoinGecko unavailable: ${response.status}`);
  }
  const json = (await response.json()) as Record<string, Record<string, number | string>>;
  const raw = json[COINGECKO_IDS[cryptoType]]?.[fiatCurrency.toLowerCase()];
  if (raw === undefined || raw === null) {
    throw new Error('CoinGecko response missing price');
  }
  return parseDecimal(raw);
};

export const fetchCryptoRate = async (
  cryptoTypeInput: string,
  senderCurrencyInput: string,
): Promise<{ rate: Decimal; rateSource: RateSource }> => {
  const cryptoType = ensureToken(cryptoTypeInput);
  const senderCurrency = senderCurrencyInput.toUpperCase();

  try {
    // Always use CoinGecko for reliability
    const fiatRate = await withRetry(() => fetchCoingeckoCryptoRate(cryptoType, senderCurrency));
    return { rate: fiatRate, rateSource: 'coingecko' };
  } catch (error) {
    console.error('Crypto rate fetch failed:', error);
    throw error;
  }
};

export const fetchFiatRate = async (
  fromCurrencyInput: string,
  toCurrencyInput: string,
): Promise<Decimal> => {
  const fromCurrency = fromCurrencyInput.toUpperCase();
  const toCurrency = toCurrencyInput.toUpperCase();
  if (fromCurrency === toCurrency) {
    return new Decimal(1);
  }

  const url = `${env.FIAT_RATE_API_URL}/latest?from=${fromCurrency}&to=${toCurrency}`;
  const headers: Record<string, string> = {};
  if (env.FIAT_RATE_API_KEY) {
    headers.Authorization = `Bearer ${env.FIAT_RATE_API_KEY}`;
  }

  try {
    const response = await withRetry(() => fetch(url, { headers }));
    if (!response.ok) {
      console.error(`Fiat rate API error: ${response.status}`, await response.text());
      throw new Error(`Fiat rate API unavailable: ${response.status}`);
    }

    const json = (await response.json()) as { rates?: Record<string, number | string> };
    const raw = json.rates?.[toCurrency];
    if (raw === undefined || raw === null) {
      console.error('Fiat rate response missing rate:', json);
      throw new Error('Fiat rate response missing rate');
    }
    return parseDecimal(raw);
  } catch (error) {
    console.error('Fiat rate fetch error:', error);
    throw error;
  }
};
