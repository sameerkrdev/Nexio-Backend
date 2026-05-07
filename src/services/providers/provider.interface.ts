import type Decimal from 'decimal.js';
import type { WithdrawalMethod } from '../../generated/prisma/client';
import { MockProvider } from './mock.provider';

export interface PayoutProvider {
  submitPayout(params: {
    amount: Decimal;
    currency: string;
    method: WithdrawalMethod;
    encryptedAccountDetails: string;
    withdrawalId: string;
  }): Promise<{
    providerReference: string;
    estimatedArrival: string;
    mockCompletesAt?: Date;
  }>;

  checkStatus(providerReference: string): Promise<{
    status: 'processing' | 'completed' | 'failed';
    failureReason?: string;
  }>;

  validateAccount(
    method: WithdrawalMethod,
    details: unknown,
  ): Promise<{
    valid: boolean;
    displayName: string;
    error?: string;
  }>;
}

export class ProviderNotFoundError extends Error {
  constructor(providerName: string) {
    super(`Provider "${providerName}" is not registered.`);
    this.name = 'ProviderNotFoundError';
  }
}

const PROVIDERS: Record<string, PayoutProvider> = {
  mock: new MockProvider(),
};

export const getProvider = (name: string): PayoutProvider => {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new ProviderNotFoundError(name);
  }
  return provider;
};
