import { z } from 'zod';
import { WithdrawalStatus } from '../generated/prisma/client';

export const createWithdrawalSchema = z.object({
  body: z.object({
    accountId: z.string().min(1),
    amount: z.coerce.number().positive(),
    note: z.string().trim().max(280).optional(),
  }),
});

export const withdrawalListQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.nativeEnum(WithdrawalStatus).optional(),
  }),
});

export const withdrawalIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

export type CreateWithdrawalBody = z.infer<typeof createWithdrawalSchema>['body'];
export type WithdrawalListQuery = z.infer<typeof withdrawalListQuerySchema>['query'];
export type WithdrawalIdParams = z.infer<typeof withdrawalIdParamSchema>['params'];
