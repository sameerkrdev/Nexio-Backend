import { z } from 'zod';

export const indexValidationSchema = z.object({
  body: z.object({
    name: z.string(),
    email: z.email(),
  }),
});

export type IndexValidationSchema = z.infer<typeof indexValidationSchema>;
