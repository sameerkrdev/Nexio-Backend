import { z } from 'zod';
import { WalletEntryReason, WalletTransactionType } from '../generated/prisma/client';

const optionalDateString = z
  .string()
  .optional()
  .transform((value) => (value ? new Date(value) : undefined))
  .refine((value) => value === undefined || !Number.isNaN(value.getTime()), 'Invalid date format');

export const walletTransactionListQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    type: z.nativeEnum(WalletTransactionType).optional(),
    reason: z.nativeEnum(WalletEntryReason).optional(),
    from: optionalDateString,
    to: optionalDateString,
  }),
});

export const walletTransactionParamsSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

export type WalletTransactionListQuery = z.infer<typeof walletTransactionListQuerySchema>['query'];
export type WalletTransactionParams = z.infer<typeof walletTransactionParamsSchema>['params'];
