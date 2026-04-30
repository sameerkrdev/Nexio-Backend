import { HttpError } from 'http-errors';

export type AppError = HttpError & {
  details?: unknown;
};
