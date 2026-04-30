import type { Request } from 'express';
import type { UserValidationSchema } from './../zodSchema/user.schema';

export interface UserCreateRequest extends Request {
  body: UserValidationSchema['body'];
}
