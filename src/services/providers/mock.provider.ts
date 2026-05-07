import { randomUUID } from 'crypto';
import { z } from 'zod';
import prisma from '../../config/prisma.config';
import type { WithdrawalMethod } from '../../generated/prisma/client';
import { decryptAccountDetails } from '../../utils/encryption';
import type { PayoutProvider } from './provider.interface';

type AccountDetails = Record<string, unknown>;

const zodErrorMessage = (error: z.ZodError) =>
  error.issues.map((issue) => issue.message).join(', ');

const zelleSchema = z
  .object({
    zelleEmail: z.string().email().optional(),
    zellePhone: z.string().optional(),
  })
  .refine((value) => Boolean(value.zelleEmail || value.zellePhone), {
    message: 'Either zelleEmail or zellePhone is required',
  });

const METHOD_SCHEMAS: Partial<Record<WithdrawalMethod, z.ZodTypeAny>> = {
  UPI: z.object({
    upiId: z.string().regex(/^[\w.-]+@[\w]+$/),
  }),
  BANK_TRANSFER: z.object({
    accountNumber: z.string().min(4),
    ifscCode: z
      .string()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/)
      .optional(),
    accountHolderName: z.string().optional(),
    bankName: z.string().optional(),
  }),
  ACH: z.object({
    routingNumber: z.string().length(9),
    accountNumber: z.string(),
    accountHolderName: z.string(),
    accountType: z.enum(['checking', 'savings']),
  }),
  WIRE: z.object({
    routingNumber: z.string(),
    accountNumber: z.string(),
    accountHolderName: z.string(),
    bankName: z.string(),
  }),
  ZELLE: zelleSchema,
  SEPA: z.object({
    iban: z.string().min(15),
    accountHolderName: z.string(),
  }),
  SEPA_INSTANT: z.object({
    iban: z.string().min(15),
    accountHolderName: z.string(),
  }),
  FASTER_PAYMENTS: z.object({
    sortCode: z.string(),
    accountNumber: z.string(),
    accountHolderName: z.string(),
  }),
  ZENGIN: z.object({
    bankCode: z.string(),
    branchCode: z.string(),
    accountNumber: z.string(),
    accountHolderName: z.string(),
  }),
  PAYNOW: z.object({
    paynowId: z.string(),
  }),
  INTERAC: z.object({
    email: z.string().email(),
  }),
  EFT: z.object({
    transitNumber: z.string(),
    institutionNumber: z.string(),
    accountNumber: z.string(),
  }),
  OSKO: z.object({
    bsb: z.string(),
    accountNumber: z.string(),
    accountHolderName: z.string(),
  }),
  NPP: z.object({
    bsb: z.string(),
    accountNumber: z.string(),
    accountHolderName: z.string(),
  }),
  IMPS: z.object({
    accountNumber: z.string().min(4),
    ifscCode: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/),
    accountHolderName: z.string(),
    bankName: z.string(),
  }),
  NEFT: z.object({
    accountNumber: z.string().min(4),
    ifscCode: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/),
    accountHolderName: z.string(),
    bankName: z.string(),
  }),
  FAST: z.object({
    paynowId: z.string(),
  }),
};

export class MockProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MockProviderError';
  }
}

const randomRef = (method: WithdrawalMethod) =>
  `MOCK_${method}_${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;

const toMaskedLast4 = (value: unknown) => {
  if (typeof value !== 'string') return '0000';
  return value.slice(-4);
};

const getMockDelaySeconds = (method: WithdrawalMethod) => {
  if (['UPI', 'PAYNOW', 'FAST', 'SEPA_INSTANT'].includes(method)) return 10;
  if (['IMPS', 'FASTER_PAYMENTS', 'OSKO', 'NPP'].includes(method)) return 30;
  if (['NEFT', 'ACH', 'INTERAC', 'EFT'].includes(method)) return 120;
  if (method === 'SEPA') return 180;
  if (method === 'ZELLE') return 60;
  return 300;
};

const getEstimatedArrivalLabel = (method: WithdrawalMethod) => {
  if (['UPI', 'PAYNOW', 'FAST', 'SEPA_INSTANT'].includes(method)) return 'Arrives instantly';
  if (['IMPS', 'FASTER_PAYMENTS', 'OSKO', 'NPP', 'ZELLE'].includes(method))
    return 'Usually within minutes';
  if (['NEFT', 'ACH', 'INTERAC', 'EFT', 'SEPA'].includes(method)) return 'Usually within 1-2 days';
  return 'Usually within 1-3 business days';
};

const getSchemaForMethod = (method: WithdrawalMethod) => METHOD_SCHEMAS[method];

const getDisplayName = (method: WithdrawalMethod, details: AccountDetails): string => {
  switch (method) {
    case 'UPI':
      return String(details.upiId ?? '');
    case 'BANK_TRANSFER':
    case 'IMPS':
    case 'NEFT':
      return `${String(details.bankName ?? 'Bank')} ****${toMaskedLast4(details.accountNumber)}`;
    case 'ACH':
    case 'WIRE':
      return `${String(details.accountType ?? 'account')} ****${toMaskedLast4(details.accountNumber)}`;
    case 'SEPA':
    case 'SEPA_INSTANT':
      return `****${toMaskedLast4(details.iban)}`;
    case 'FASTER_PAYMENTS':
    case 'ZENGIN':
    case 'EFT':
    case 'OSKO':
    case 'NPP':
      return `****${toMaskedLast4(details.accountNumber)}`;
    case 'PAYNOW':
    case 'FAST':
      return String(details.paynowId ?? '');
    case 'ZELLE':
      return String(details.zelleEmail ?? details.zellePhone ?? '');
    case 'INTERAC':
      return String(details.email ?? '');
    default:
      return `Mock Account ****${randomUUID().slice(0, 4).toUpperCase()}`;
  }
};

export class MockProvider implements PayoutProvider {
  async submitPayout(params: {
    amount: import('decimal.js').default;
    currency: string;
    method: WithdrawalMethod;
    encryptedAccountDetails: string;
    withdrawalId: string;
  }) {
    const accountDetails = decryptAccountDetails(params.encryptedAccountDetails);
    void accountDetails;
    void params.amount;
    void params.currency;
    void params.withdrawalId;

    if (Math.random() < 0.05) {
      throw new MockProviderError('Simulated rejection');
    }

    const delaySeconds = getMockDelaySeconds(params.method);
    const mockCompletesAt = new Date(Date.now() + delaySeconds * 1000);
    return {
      providerReference: randomRef(params.method),
      estimatedArrival: getEstimatedArrivalLabel(params.method),
      mockCompletesAt,
    };
  }

  async checkStatus(providerReference: string) {
    const withdrawal = await prisma.withdrawal.findFirst({
      where: { providerReference },
      select: {
        mockCompletesAt: true,
      },
    });

    if (!withdrawal || !withdrawal.mockCompletesAt) {
      return { status: 'processing' as const };
    }

    if (Date.now() >= withdrawal.mockCompletesAt.getTime()) {
      return { status: 'completed' as const };
    }

    return { status: 'processing' as const };
  }

  async validateAccount(method: WithdrawalMethod, details: unknown) {
    const schema = getSchemaForMethod(method);
    if (!schema) {
      return {
        valid: false,
        displayName: '',
        error: `Unsupported method "${method}"`,
      };
    }

    const parsed = schema.safeParse(details);
    if (!parsed.success) {
      return {
        valid: false,
        displayName: '',
        error: zodErrorMessage(parsed.error),
      };
    }

    return {
      valid: true,
      displayName: getDisplayName(method, parsed.data as AccountDetails),
    };
  }
}
