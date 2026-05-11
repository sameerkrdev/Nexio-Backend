import { z } from 'zod';
import { PaymentStatus, WithdrawalMethod } from '../generated/prisma/client';

const conversionFieldsSchema = z.object({
  cryptoType: z
    .string()
    .min(1)
    .transform((v) => v.toUpperCase()),
  cryptoAmount: z.string().min(1),
  platformFeeAmount: z.string().min(1),
  platformFeeCrypto: z.string().min(1),
  totalCryptoAmount: z.string().min(1),
  senderCurrency: z
    .string()
    .min(1)
    .transform((v) => v.toUpperCase()),
  senderCurrencyAmount: z.string().min(1),
  receiverCurrency: z
    .string()
    .min(1)
    .transform((v) => v.toUpperCase()),
  receiverCurrencyAmount: z.string().min(1),
  cryptoToSenderRate: z.string().min(1),
  senderToReceiverRate: z.string().min(1),
  platformFeePercent: z.string().min(1),
});

const platformRecipientSchema = z
  .object({
    recipientType: z.literal('platform'),
    recipientUsername: z.string().min(1, 'recipientUsername is required'),
  })
  .merge(conversionFieldsSchema);

const externalRecipientSchema = z
  .object({
    recipientType: z.literal('external'),
    receiverPhone: z.string().min(5),
    receiverPaymentMethod: z.nativeEnum(WithdrawalMethod),
    receiverPaymentDetails: z.record(z.string(), z.unknown()),
  })
  .merge(conversionFieldsSchema);

export const createPaymentSchema = z.object({
  body: z.discriminatedUnion('recipientType', [platformRecipientSchema, externalRecipientSchema]),
});

export const paymentQuoteSchema = z.object({
  query: z
    .object({
      crypto: z
        .string()
        .min(1)
        .transform((v) => v.toUpperCase()),
      senderCurrency: z
        .string()
        .min(1)
        .transform((v) => v.toUpperCase()),
      receiverUsername: z.string().min(1).optional(),
      receiverPhone: z.string().min(5).optional(),
    })
    .refine(
      (value) =>
        (value.receiverUsername && !value.receiverPhone) ||
        (!value.receiverUsername && value.receiverPhone),
      'Provide either receiverUsername or receiverPhone',
    ),
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
export type PaymentQuoteQuery = z.infer<typeof paymentQuoteSchema>['query'];
export type PaymentHistoryQuery = z.infer<typeof paymentHistorySchema>['query'];
export type PaymentIdParams = z.infer<typeof paymentIdParamSchema>['params'];
