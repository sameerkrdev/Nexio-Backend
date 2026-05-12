import createHttpError from 'http-errors';
import env from '../config/dotenv.config';
import logger from '../config/logger.config';

interface DodoCustomerInput {
  email: string;
  name?: string | null;
  phoneNumber?: string | null;
}

export interface CreateTopUpPaymentInput {
  /** Whole-unit amount (e.g. 500 → ₹500.00). */
  amount: number;
  /** ISO 4217 code — INR, USD, EUR, GBP, etc. */
  currency: string;
  /** ISO 3166-1 alpha-2 country code for billing — IN, US, GB, etc. */
  country: string;
  customer: DodoCustomerInput;
  /** Free-form metadata Dodo echoes back on webhooks. Use userId/purpose here. */
  metadata: Record<string, string>;
  /** Where Dodo redirects the user after they finish paying. App deep-link works. */
  returnUrl?: string;
  /**
   * Which product to charge against in Dodo. Defaults to env.DODO_TOPUP_PRODUCT_ID
   * (the wallet top-up SKU). For other flows like withdrawal-verification you
   * can reuse the same product — Dodo lets us override the amount per request.
   */
  productId?: string;
}

export interface CreateTopUpPaymentResult {
  /** Hosted-checkout URL to open in the user's browser. */
  checkoutUrl: string;
  /** Dodo's payment ID, store this if you want to correlate later. */
  paymentId: string;
  /** ISO timestamp after which the payment can no longer be completed. */
  expiresAt: string | null;
  /** Total amount (lowest denomination) Dodo will charge. */
  totalAmount: number;
}

/**
 * Convert a whole-unit amount to Dodo's lowest-denomination integer.
 *   ₹500.00 → 50000   (paise)
 *   $4.99   → 499     (cents)
 * JPY and a few others are already in their lowest denomination — for the
 * minimal proof we treat 2-decimal currencies as the common case.
 */
const toLowestDenomination = (amount: number, currency: string): number => {
  if (currency === 'JPY') return Math.round(amount);
  return Math.round(amount * 100);
};

/**
 * Create a Dodo one-time payment and return the hosted-checkout URL.
 *
 * Uses Dodo's `POST /payments` endpoint (sandbox: test.dodopayments.com,
 * production: live.dodopayments.com). The endpoint is marked for future
 * deprecation in favor of Checkout Sessions — fine for a minimal proof, swap
 * later if needed.
 */
export const createTopUpPayment = async (
  input: CreateTopUpPaymentInput,
): Promise<CreateTopUpPaymentResult> => {
  if (!env.DODO_API_KEY) {
    throw createHttpError(503, 'Dodo Payments is not configured (DODO_API_KEY missing).');
  }
  const productId = input.productId ?? env.DODO_TOPUP_PRODUCT_ID;
  if (!productId) {
    throw createHttpError(
      503,
      'Dodo product is not configured (DODO_TOPUP_PRODUCT_ID missing). ' +
        'Create a product in Dodo Dashboard → Products and set its ID here.',
    );
  }
  if (input.amount <= 0) {
    throw createHttpError(400, 'Amount must be greater than 0.');
  }

  const url = `${env.DODO_API_BASE_URL}/payments`;
  const amountLowest = toLowestDenomination(input.amount, input.currency);
  const body = {
    product_cart: [
      {
        product_id: productId,
        quantity: 1,
        amount: amountLowest,
      },
    ],
    customer: {
      email: input.customer.email,
      name: input.customer.name ?? undefined,
      phone_number: input.customer.phoneNumber ?? undefined,
    },
    billing: {
      country: input.country,
    },
    billing_currency: input.currency,
    metadata: input.metadata,
    return_url: input.returnUrl,
    payment_link: true,
  };

  logger.info('[Dodo] createTopUpPayment → POST /payments', {
    url,
    amount: amountLowest,
    currency: input.currency,
    metadata: input.metadata,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.DODO_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    logger.error('[Dodo] POST /payments returned non-2xx', {
      status: response.status,
      body: text.slice(0, 500),
    });
    throw createHttpError(502, `Dodo payment creation failed (status ${response.status}).`);
  }

  let parsed: {
    payment_id?: string;
    payment_link?: string | null;
    expires_on?: string | null;
    total_amount?: number;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    logger.error('[Dodo] POST /payments returned non-JSON body', {
      body: text.slice(0, 500),
    });
    throw createHttpError(502, 'Dodo returned an unparseable response.');
  }

  if (!parsed.payment_link) {
    logger.error('[Dodo] response missing payment_link', { parsed });
    throw createHttpError(502, 'Dodo did not return a checkout URL.');
  }
  if (!parsed.payment_id) {
    throw createHttpError(502, 'Dodo did not return a payment_id.');
  }

  return {
    checkoutUrl: parsed.payment_link,
    paymentId: parsed.payment_id,
    expiresAt: parsed.expires_on ?? null,
    totalAmount: parsed.total_amount ?? 0,
  };
};

export interface CreateSubscriptionInput {
  /** Subscription product ID in Dodo dashboard (recurring SKU, not one-time). */
  productId: string;
  /** ISO 3166-1 alpha-2 country code for billing. */
  country: string;
  customer: DodoCustomerInput;
  /** Free-form metadata Dodo echoes back on the subscription.* webhook events. */
  metadata: Record<string, string>;
  /** Where Dodo redirects the user after they finish subscribing. */
  returnUrl?: string;
}

export interface CreateSubscriptionResult {
  /** Hosted-checkout URL to open in the user's browser. */
  checkoutUrl: string;
  /** Dodo's subscription_id — store this to correlate webhook events. */
  subscriptionId: string;
  /** payment_id of the first charge in this subscription. */
  paymentId: string;
  /** ISO timestamp after which the payment link can no longer be paid. */
  expiresAt: string | null;
}

/**
 * Create a Dodo subscription. Posts to /subscriptions (NOT /payments — those
 * are for one-time charges only and Dodo rejects subscription products there).
 *
 * On the user's first successful payment, Dodo fires the `subscription.active`
 * webhook event which our handler at webhooks/dodo.webhook.ts consumes to
 * activate the user's premium tier server-side.
 */
export const createSubscription = async (
  input: CreateSubscriptionInput,
): Promise<CreateSubscriptionResult> => {
  if (!env.DODO_API_KEY) {
    throw createHttpError(503, 'Dodo Payments is not configured (DODO_API_KEY missing).');
  }
  if (!input.productId) {
    throw createHttpError(
      503,
      'Dodo subscription product is not configured (DODO_SUBSCRIPTION_PRODUCT_ID missing). ' +
        'Create a recurring product in Dodo Dashboard → Products and set its ID.',
    );
  }

  const url = `${env.DODO_API_BASE_URL}/subscriptions`;
  const body = {
    product_id: input.productId,
    quantity: 1,
    customer: {
      email: input.customer.email,
      name: input.customer.name ?? undefined,
      phone_number: input.customer.phoneNumber ?? undefined,
    },
    billing: {
      country: input.country,
    },
    metadata: input.metadata,
    return_url: input.returnUrl,
    payment_link: true,
  };

  logger.info('[Dodo] createSubscription → POST /subscriptions', {
    url,
    productId: input.productId,
    metadata: input.metadata,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.DODO_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    logger.error('[Dodo] POST /subscriptions returned non-2xx', {
      status: response.status,
      body: text.slice(0, 500),
    });
    throw createHttpError(502, `Dodo subscription creation failed (status ${response.status}).`);
  }

  let parsed: {
    subscription_id?: string;
    payment_id?: string;
    payment_link?: string | null;
    expires_on?: string | null;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    logger.error('[Dodo] POST /subscriptions returned non-JSON body', {
      body: text.slice(0, 500),
    });
    throw createHttpError(502, 'Dodo returned an unparseable response.');
  }

  if (!parsed.payment_link) {
    logger.error('[Dodo] subscription response missing payment_link', { parsed });
    throw createHttpError(502, 'Dodo did not return a checkout URL.');
  }
  if (!parsed.subscription_id) {
    throw createHttpError(502, 'Dodo did not return a subscription_id.');
  }

  return {
    checkoutUrl: parsed.payment_link,
    subscriptionId: parsed.subscription_id,
    paymentId: parsed.payment_id ?? '',
    expiresAt: parsed.expires_on ?? null,
  };
};

export interface DodoSubscriptionStatus {
  /** Dodo's status string. Common values: 'active', 'pending', 'cancelled', 'expired', 'on_hold', 'failed'. */
  status: string;
  /** ISO timestamp of next billing — what we use as the subscription expiry. */
  nextBillingDate: string | null;
  /** Metadata Dodo echoes back (we set userId + purpose at create time). */
  metadata: Record<string, string>;
}

/**
 * Fetch the current state of a subscription directly from Dodo. Used by the
 * /subscriptions/verify endpoint as a fallback when the webhook is slow or
 * the user comes back to the app before subscription.active has fired.
 */
export const getSubscription = async (subscriptionId: string): Promise<DodoSubscriptionStatus> => {
  if (!env.DODO_API_KEY) {
    throw createHttpError(503, 'Dodo Payments is not configured (DODO_API_KEY missing).');
  }
  if (!subscriptionId) {
    throw createHttpError(400, 'subscriptionId is required.');
  }

  const url = `${env.DODO_API_BASE_URL}/subscriptions/${subscriptionId}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${env.DODO_API_KEY}`,
      Accept: 'application/json',
    },
  });

  const text = await response.text();
  if (!response.ok) {
    logger.error('[Dodo] GET /subscriptions/{id} returned non-2xx', {
      status: response.status,
      body: text.slice(0, 500),
    });
    throw createHttpError(502, `Dodo subscription lookup failed (status ${response.status}).`);
  }

  let parsed: {
    status?: string;
    next_billing_date?: string | null;
    metadata?: Record<string, string>;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw createHttpError(502, 'Dodo returned an unparseable response.');
  }

  return {
    status: parsed.status ?? 'unknown',
    nextBillingDate: parsed.next_billing_date ?? null,
    metadata: parsed.metadata ?? {},
  };
};
