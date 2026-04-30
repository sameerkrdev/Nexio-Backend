import { z } from 'zod';

export const userValidationSchema = z.object({
  body: z.object({
    name: z.string(),
    email: z.email(),
  }),
});

export type UserValidationSchema = z.infer<typeof userValidationSchema>;
