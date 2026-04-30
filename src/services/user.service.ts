import createHttpError from 'http-errors';
import prisma from '../config/prisma';
import type { Prisma } from '../generated/prisma/client';

export const createUser = async (data: Prisma.UserCreateInput) => {
  const existingUser = await prisma.user.findFirst({ where: { email: data.email } });
  if (existingUser) {
    const error = createHttpError(401, 'User is already exits. Try again with different email');
    throw error;
  }

  const newUser = await prisma.user.create({
    data: data,
  });

  return newUser;
};
