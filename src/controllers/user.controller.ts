import type { NextFunction, Response } from 'express';
import type { UserCreateRequest } from '../types/user.type';
import { createUser as createUserService } from '../services/user.service';

export const createUser = async (req: UserCreateRequest, res: Response, next: NextFunction) => {
  try {
    const { email, name } = req.body;

    const newUser = await createUserService({ email, name });

    res.json({ success: true, data: newUser, message: 'User is created successfully' });
  } catch (error) {
    next(error);
  }
};
