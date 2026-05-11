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

// In-memory rate cache. The same rate is returned for repeated lookups within
// QUOTE_EXPIRES_IN_SECONDS, so the rate the quote endpoint hands to the client
// is the SAME rate the payment-initiate endpoint validates against. Without
// this, two back-to-back upstream calls return slightly different numbers
// (CoinGecko re-aggregates server-side; FX feeds tick), which makes the strict
// quote-validation throw "quote expired" even on fresh user submissions.
const CACHE_TTL_MS = env.QUOTE_EXPIRES_IN_SECONDS * 1000;

interface CachedRate<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CachedRate<unknown>>();

const getCached = <T>(key: string): T | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
};

const setCached = <T>(key: string, value: T): void => {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
};

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
  const cacheKey = `crypto:${cryptoType}:${senderCurrency}`;

  const cached = getCached<{ rate: string; rateSource: RateSource }>(cacheKey);
  if (cached) {
    return { rate: parseDecimal(cached.rate), rateSource: cached.rateSource };
  }

  try {
    // Always use CoinGecko for reliability
    const fiatRate = await withRetry(() => fetchCoingeckoCryptoRate(cryptoType, senderCurrency));
    setCached(cacheKey, { rate: fiatRate.toString(), rateSource: 'coingecko' as RateSource });
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

  const cacheKey = `fiat:${fromCurrency}:${toCurrency}`;
  const cached = getCached<string>(cacheKey);
  if (cached) {
    return parseDecimal(cached);
  }

  const url = `${env.FIAT_RATE_API_URL}/latest?from=${fromCurrency}&to=${toCurrency}`;
  const headers: Record<string, string> = {};
  if (env.FIAT_RATE_API_KEY) {
    headers.Authorization = `Bearer ${env.FIAT_RATE_API_KEY}`;
  }

  try {
    const response = await withRetry(() => fetch(url, { headers }));
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Fiat rate API error: ${response.status}`, errorText);
      throw new Error(`Fiat rate API unavailable: ${response.status}`);
    }

    const json = (await response.json()) as { rates?: Record<string, number | string> };
    const raw = json.rates?.[toCurrency];
    if (raw === undefined || raw === null) {
      console.error('Fiat rate response missing rate:', json);
      throw new Error('Fiat rate response missing rate');
    }
    const rate = parseDecimal(raw);
    setCached(cacheKey, rate.toString());
    return rate;
  } catch (error) {
    console.error('Fiat rate fetch error:', {
      from: fromCurrency,
      to: toCurrency,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
