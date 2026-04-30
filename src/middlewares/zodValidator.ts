import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import createHttpError from 'http-errors';

const zodValidatorMiddleware = <T extends z.ZodTypeAny>(schema: T) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    console.log(req.body);
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    if (!result.success) {
      const errorTree = z.treeifyError(result.error);

      return next(
        createHttpError(400, 'Validation failed', {
          details: errorTree,
        }),
      );
    }

    const { body, query, params } = result.data as {
      body?: unknown;
      query?: unknown;
      params?: unknown;
    };

    if (body !== undefined) req.body = body;
    if (query !== undefined) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        req.query = query as any;
      } catch {
        // Express 5 can expose req.query as getter-only in some setups.
        // Fall back to mutating the existing query object.
        if (
          typeof req.query === 'object' &&
          req.query !== null &&
          typeof query === 'object' &&
          query !== null
        ) {
          const currentQuery = req.query as Record<string, unknown>;
          Object.keys(currentQuery).forEach((key) => {
            delete currentQuery[key];
          });
          Object.assign(currentQuery, query as Record<string, unknown>);
        }
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (params !== undefined) req.params = params as any;

    return next();
  };
};

export default zodValidatorMiddleware;
