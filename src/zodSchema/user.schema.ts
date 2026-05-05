import { z } from 'zod';
import { PublicKey } from '@solana/web3.js';

export const usernameParamSchema = z.object({
  params: z.object({
    username: z.string().min(1),
  }),
});

export const updateWalletSchema = z.object({
  body: z.object({
    solanaPublicKey: z
      .string()
      .min(32)
      .max(64)
      .refine((value) => {
        try {
          // Validate base58 Solana key before saving.
          // Actual normalization occurs in service layer.
          new PublicKey(value);
          return true;
        } catch {
          return false;
        }
      }, 'Invalid Solana public key'),
  }),
});

export type UsernameParam = z.infer<typeof usernameParamSchema>['params'];
export type UpdateWalletBody = z.infer<typeof updateWalletSchema>['body'];
