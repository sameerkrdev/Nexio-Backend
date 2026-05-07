import { z } from 'zod';
import { WithdrawalMethod } from '../generated/prisma/client';

const baseAccountBody = z.object({
  method: z.nativeEnum(WithdrawalMethod),
  nickname: z.string().trim().min(1).max(64).optional(),
});

const upiSchema = baseAccountBody.extend({
  method: z.literal(WithdrawalMethod.UPI),
  upiId: z.string().regex(/^[\w.-]+@[\w]+$/),
});

const inBankTransferSchema = baseAccountBody.extend({
  method: z.literal(WithdrawalMethod.BANK_TRANSFER),
  accountNumber: z.string().min(4),
  ifscCode: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/),
  accountHolderName: z.string().min(1),
  bankName: z.string().min(1),
});

const achSchema = baseAccountBody.extend({
  method: z.literal(WithdrawalMethod.ACH),
  routingNumber: z.string().length(9),
  accountNumber: z.string().min(4),
  accountHolderName: z.string().min(1),
  accountType: z.enum(['checking', 'savings']),
});

const wireSchema = baseAccountBody.extend({
  method: z.literal(WithdrawalMethod.WIRE),
  routingNumber: z.string().min(1),
  accountNumber: z.string().min(4),
  accountHolderName: z.string().min(1),
  bankName: z.string().min(1),
});

const zelleSchema = baseAccountBody
  .extend({
    method: z.literal(WithdrawalMethod.ZELLE),
    zelleEmail: z.string().email().optional(),
    zellePhone: z.string().optional(),
  })
  .refine((value) => Boolean(value.zelleEmail || value.zellePhone), {
    message: 'Either zelleEmail or zellePhone is required',
    path: ['zelleEmail'],
  });

const sepaSchema = baseAccountBody.extend({
  method: z.union([z.literal(WithdrawalMethod.SEPA), z.literal(WithdrawalMethod.SEPA_INSTANT)]),
  iban: z.string().min(15),
  accountHolderName: z.string().min(1),
});

const fasterPaymentsSchema = baseAccountBody.extend({
  method: z.literal(WithdrawalMethod.FASTER_PAYMENTS),
  sortCode: z.string().min(1),
  accountNumber: z.string().min(4),
  accountHolderName: z.string().min(1),
});

const zenginSchema = baseAccountBody.extend({
  method: z.literal(WithdrawalMethod.ZENGIN),
  bankCode: z.string().min(1),
  branchCode: z.string().min(1),
  accountNumber: z.string().min(4),
  accountHolderName: z.string().min(1),
});

const payNowSchema = baseAccountBody.extend({
  method: z.union([z.literal(WithdrawalMethod.PAYNOW), z.literal(WithdrawalMethod.FAST)]),
  paynowId: z.string().min(1),
});

const interacSchema = baseAccountBody.extend({
  method: z.literal(WithdrawalMethod.INTERAC),
  email: z.string().email(),
});

const eftSchema = baseAccountBody.extend({
  method: z.literal(WithdrawalMethod.EFT),
  transitNumber: z.string().min(1),
  institutionNumber: z.string().min(1),
  accountNumber: z.string().min(4),
});

const oskoSchema = baseAccountBody.extend({
  method: z.union([z.literal(WithdrawalMethod.OSKO), z.literal(WithdrawalMethod.NPP)]),
  bsb: z.string().min(1),
  accountNumber: z.string().min(4),
  accountHolderName: z.string().min(1),
});

export const createWithdrawalAccountSchema = z.object({
  body: z.union([
    upiSchema,
    inBankTransferSchema,
    achSchema,
    wireSchema,
    zelleSchema,
    sepaSchema,
    fasterPaymentsSchema,
    zenginSchema,
    payNowSchema,
    interacSchema,
    eftSchema,
    oskoSchema,
  ]),
});

export const withdrawalAccountIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

export type CreateWithdrawalAccountBody = z.infer<typeof createWithdrawalAccountSchema>['body'];
export type WithdrawalAccountIdParams = z.infer<typeof withdrawalAccountIdParamSchema>['params'];
