import { z } from 'zod';
import { Currency, PaymentStatus } from '../generated/prisma/client';

export const createPaymentSchema = z.object({
  body: z.object({
    recipientUsername: z.string().min(1, 'recipientUsername is required'),
    amount: z
      .union([z.string(), z.number()])
      .transform((value) => String(value))
      .refine((value) => Number(value) > 0, 'amount must be greater than 0'),
    currency: z.nativeEnum(Currency),
  }),
});

export const paymentHistorySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.nativeEnum(PaymentStatus).optional(),
  }),
});

export const paymentIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

export type CreatePaymentBody = z.infer<typeof createPaymentSchema>['body'];
export type PaymentHistoryQuery = z.infer<typeof paymentHistorySchema>['query'];
export type PaymentIdParams = z.infer<typeof paymentIdParamSchema>['params'];
