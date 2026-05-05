import Decimal from 'decimal.js';

export const solToLamports = (sol: number | string): bigint => {
  const lamports = new Decimal(sol).mul('1000000000').toFixed(0, Decimal.ROUND_HALF_UP);
  return BigInt(lamports);
};

export const lamportsToSol = (lamports: bigint): string => {
  return new Decimal(lamports.toString()).div('1000000000').toString();
};

export const toTokenUnits = (amount: number | string, decimals: number): bigint => {
  const units = new Decimal(amount)
    .mul(new Decimal(10).pow(decimals))
    .toFixed(0, Decimal.ROUND_HALF_UP);
  return BigInt(units);
};

export const fromTokenUnits = (units: bigint, decimals: number): string => {
  return new Decimal(units.toString()).div(new Decimal(10).pow(decimals)).toString();
};
