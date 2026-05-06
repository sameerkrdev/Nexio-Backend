import type { NextFunction, Request, Response } from 'express';
import createHttpError from 'http-errors';
import prisma from '../config/prisma.config';
import type { AuthenticatedRequest } from '../types/auth.type';
import { updateUserWallet } from '../services/payment.service';
import type { UpdateWalletBody, UsernameParam } from '../zodSchema/user.schema';

export const searchUsers = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const q = req.query.q as string;
    if (!q || q.length < 2) {
      return res.status(200).json({ success: true, data: [] });
    }

    const users = await prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
        ],
        ...(req.user?.userId ? { id: { not: req.user.userId } } : {}),
      },
      select: {
        id: true,
        username: true,
        name: true,
      },
      take: 20,
    });

    return res.status(200).json({ success: true, data: users });
  } catch (err) {
    return next(err);
  }
};

export const getUserByUsername = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username } = req.params as UsernameParam;
    const user = await prisma.user.findUnique({
      where: { username },
      select: { id: true, username: true, email: true, createdAt: true },
    });

    if (!user) {
      throw createHttpError(404, 'User not found.');
    }

    return res.status(200).json({ success: true, data: user });
  } catch (err) {
    return next(err);
  }
};

export const patchMyWallet = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.userId) {
      throw createHttpError(401, 'Unauthorized');
    }
    const { solanaPublicKey } = req.body as UpdateWalletBody;
    const updated = await updateUserWallet(req.user.userId, solanaPublicKey);
    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    return next(err);
  }
};
