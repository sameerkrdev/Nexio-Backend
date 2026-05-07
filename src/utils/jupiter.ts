import env from '../config/dotenv.config';
import logger from '../config/logger.config';
import { withRetry } from './backoff';

interface JupiterHttpErrorOptions {
  status: number;
  body: string;
  retryable: boolean;
}

export class JupiterHttpError extends Error {
  status: number;
  body: string;
  retryable: boolean;

  constructor(message: string, options: JupiterHttpErrorOptions) {
    super(message);
    this.name = 'JupiterHttpError';
    this.status = options.status;
    this.body = options.body;
    this.retryable = options.retryable;
  }
}

export interface JupiterOrderResponse {
  mode?: string;
  inputMint?: string;
  outputMint?: string;
  inAmount?: string;
  outAmount?: string;
  inUsdValue?: number;
  outUsdValue?: number;
  priceImpact?: number;
  otherAmountThreshold?: string;
  slippageBps?: number;
  routePlan?: unknown[];
  feeMint?: string;
  feeBps?: number;
  platformFee?: unknown;
  router?: string;
  transaction?: string | null;
  lastValidBlockHeight?: string;
  gasless?: boolean;
  requestId?: string;
  totalTime?: number;
  taker?: string | null;
  errorCode?: number;
  errorMessage?: string;
  error?: string;
  [key: string]: unknown;
}

export interface JupiterExecuteResponse {
  status: 'Success' | 'Failed';
  signature?: string;
  slot?: string;
  error?: string;
  code?: number;
  totalInputAmount?: string;
  totalOutputAmount?: string;
  inputAmountResult?: string;
  outputAmountResult?: string;
  swapEvents?: unknown[];
}

export interface JupiterPriceResponse {
  [mint: string]:
    | {
        usdPrice?: number;
        blockId?: number | null;
        decimals?: number;
        priceChange24h?: number | null;
      }
    | undefined;
}

interface GetOrderParams {
  inputMint: string;
  outputMint: string;
  amount: string;
  taker: string;
  slippageBps?: number;
}

interface ExecuteOrderParams {
  signedTransaction: string;
  requestId: string;
  lastValidBlockHeight?: string;
}

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const jupiterApiUrl = trimTrailingSlash(env.JUPITER_API_URL);
const jupiterPriceApiUrl = trimTrailingSlash(env.JUPITER_PRICE_API_URL);

if (!jupiterApiUrl) {
  throw new Error('Missing JUPITER_API_URL configuration');
}

if (!jupiterPriceApiUrl) {
  throw new Error('Missing JUPITER_PRICE_API_URL configuration');
}

const buildHeaders = (json = false): HeadersInit => {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (env.JUPITER_API_KEY) headers['x-api-key'] = env.JUPITER_API_KEY;
  return headers;
};

const parseJsonResponse = async <T>(response: Response): Promise<T> => {
  if (response.ok) return (await response.json()) as T;

  const body = await response.text();
  throw new JupiterHttpError(`Jupiter API request failed: ${response.status}`, {
    status: response.status,
    body,
    retryable: response.status === 429 || response.status >= 500,
  });
};

const retryableFetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const result = await withRetry(async () => {
    try {
      const response = await fetch(url, init);
      return parseJsonResponse<T>(response);
    } catch (error) {
      if (error instanceof JupiterHttpError && !error.retryable) {
        return error;
      }
      throw error;
    }
  }, env.SWAP_MAX_RETRIES);

  if (result instanceof JupiterHttpError) {
    throw result;
  }

  return result;
};

export const getOrder = async (params: GetOrderParams): Promise<JupiterOrderResponse> => {
  const searchParams = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    taker: params.taker,
  });

  if (params.slippageBps !== undefined) {
    searchParams.set('slippageBps', params.slippageBps.toString());
  }

  const order = await retryableFetchJson<JupiterOrderResponse>(
    `${jupiterApiUrl}/order?${searchParams.toString()}`,
    { headers: buildHeaders() },
  );

  logger.info('Jupiter order fetched', {
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    expectedOutAmount: order.outAmount,
    router: order.router,
    mode: order.mode,
  });

  if (!order.transaction || !order.requestId) {
    throw new JupiterHttpError('Jupiter order response missing transaction or requestId', {
      status: 400,
      body: JSON.stringify(order),
      retryable: false,
    });
  }

  return order;
};

export const executeOrder = async (params: ExecuteOrderParams): Promise<JupiterExecuteResponse> => {
  const body: Record<string, string> = {
    signedTransaction: params.signedTransaction,
    requestId: params.requestId,
  };
  if (params.lastValidBlockHeight) {
    body.lastValidBlockHeight = params.lastValidBlockHeight;
  }

  const result = await retryableFetchJson<JupiterExecuteResponse>(`${jupiterApiUrl}/execute`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(body),
  });

  logger.info('Jupiter order executed', {
    requestId: params.requestId,
    status: result.status,
    signature: result.signature,
    outputAmountResult: result.outputAmountResult,
    code: result.code,
  });

  return result;
};

export const getPrices = async (mints: string[]): Promise<JupiterPriceResponse> => {
  if (mints.length === 0) return {};
  const searchParams = new URLSearchParams({ ids: mints.join(',') });
  return retryableFetchJson<JupiterPriceResponse>(
    `${jupiterPriceApiUrl}?${searchParams.toString()}`,
    { headers: buildHeaders() },
  );
};
