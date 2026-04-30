import { z } from 'zod';

export const indexValidationSchema = z.object({
  body: z.object({
    test: z.string(),
  }),
});

export type IndexValidationSchema = z.infer<typeof indexValidationSchema>;
