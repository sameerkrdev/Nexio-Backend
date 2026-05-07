import createHttpError from 'http-errors';
import prisma from '../config/prisma.config';
import { getPaymentRail } from '../config/paymentRails';
import type { CountryCode, WithdrawalAccount, WithdrawalMethod } from '../generated/prisma/client';
import { detectCountryFromPhone } from '../utils/countryDetect';
import { encryptAccountDetails } from '../utils/encryption';
import { getProvider } from './providers/provider.interface';

interface AddWithdrawalAccountInput {
  userId: string;
  method: WithdrawalMethod;
  nickname?: string;
  details: Record<string, unknown>;
}

const serializeAccount = (account: WithdrawalAccount) => ({
  id: account.id,
  method: account.method,
  displayName: account.displayName,
  nickname: account.nickname,
  isDefault: account.isDefault,
  isVerified: account.isVerified,
  countryCode: account.countryCode,
  providerName: account.providerName,
  createdAt: account.createdAt,
});

const ensureMethodAvailable = (countryCode: CountryCode, method: WithdrawalMethod) => {
  const rail = getPaymentRail(countryCode);
  if (!rail) {
    throw createHttpError(400, 'Method not available in your region');
  }
  if (!rail.methods.includes(method)) {
    throw createHttpError(400, 'Method not available in your region');
  }
};

export const addAccount = async (input: AddWithdrawalAccountInput) => {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, phoneNumber: true },
  });
  if (!user) {
    throw createHttpError(404, 'User not found.');
  }

  const countryCode = detectCountryFromPhone(user.phoneNumber);
  const rail = getPaymentRail(countryCode);
  if (!rail) {
    throw createHttpError(400, 'Method not available in your region');
  }
  ensureMethodAvailable(countryCode, input.method);

  const profile = await prisma.userProfile.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      countryCode,
      localCurrency: rail.currency,
    },
    update: {
      countryCode,
      localCurrency: rail.currency,
    },
  });

  const providerName = rail.providers[input.method] ?? 'mock';
  const provider = getProvider(providerName);
  const validation = await provider.validateAccount(input.method, input.details);
  if (!validation.valid) {
    throw createHttpError(400, validation.error ?? 'Invalid account details');
  }

  const activeAccountCount = await prisma.withdrawalAccount.count({
    where: {
      userId: input.userId,
      deletedAt: null,
    },
  });

  const account = await prisma.withdrawalAccount.create({
    data: {
      userId: input.userId,
      profileId: profile.id,
      method: input.method,
      countryCode,
      nickname: input.nickname?.trim() || null,
      isDefault: activeAccountCount === 0,
      isVerified: true,
      providerName,
      displayName: validation.displayName,
      encryptedDetails: encryptAccountDetails(input.details),
    },
  });

  return serializeAccount(account);
};

export const listAccounts = async (userId: string) => {
  const accounts = await prisma.withdrawalAccount.findMany({
    where: {
      userId,
      deletedAt: null,
    },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });

  return accounts.map(serializeAccount);
};

export const setDefaultAccount = async (userId: string, accountId: string) => {
  const account = await prisma.withdrawalAccount.findFirst({
    where: {
      id: accountId,
      userId,
      deletedAt: null,
    },
  });
  if (!account) {
    throw createHttpError(404, 'Withdrawal account not found');
  }

  await prisma.$transaction(async (tx) => {
    await tx.withdrawalAccount.updateMany({
      where: {
        userId,
        deletedAt: null,
      },
      data: {
        isDefault: false,
      },
    });

    await tx.withdrawalAccount.update({
      where: { id: accountId },
      data: { isDefault: true },
    });
  });

  const updated = await prisma.withdrawalAccount.findFirstOrThrow({
    where: { id: accountId },
  });
  return serializeAccount(updated);
};

export const removeAccount = async (userId: string, accountId: string) => {
  const account = await prisma.withdrawalAccount.findFirst({
    where: {
      id: accountId,
      userId,
      deletedAt: null,
    },
  });
  if (!account) {
    throw createHttpError(404, 'Withdrawal account not found');
  }

  const activeWithdrawalCount = await prisma.withdrawal.count({
    where: {
      accountId,
      status: { in: ['pending', 'processing'] },
    },
  });
  if (activeWithdrawalCount > 0) {
    throw createHttpError(400, 'Cannot remove account with pending withdrawals');
  }

  await prisma.$transaction(async (tx) => {
    await tx.withdrawalAccount.update({
      where: { id: accountId },
      data: {
        deletedAt: new Date(),
        isDefault: false,
      },
    });

    if (account.isDefault) {
      const nextAccount = await tx.withdrawalAccount.findFirst({
        where: {
          userId,
          deletedAt: null,
          id: { not: accountId },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (nextAccount) {
        await tx.withdrawalAccount.update({
          where: { id: nextAccount.id },
          data: { isDefault: true },
        });
      }
    }
  });
};
