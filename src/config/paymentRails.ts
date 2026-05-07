import type { CountryCode, WithdrawalMethod } from '../generated/prisma/client';

export interface MethodLimit {
  min: number;
  max: number;
}

export interface CountryPaymentRail {
  country: string;
  currency: string;
  methods: WithdrawalMethod[];
  defaultMethod: WithdrawalMethod;
  providers: Record<WithdrawalMethod, string>;
  limits: Record<WithdrawalMethod, MethodLimit>;
}

const defineCountryRail = (
  rail: Omit<CountryPaymentRail, 'providers' | 'limits'> & {
    providers: Partial<Record<WithdrawalMethod, string>>;
    limits: Partial<Record<WithdrawalMethod, MethodLimit>>;
  },
): CountryPaymentRail => ({
  ...rail,
  providers: rail.providers as Record<WithdrawalMethod, string>,
  limits: rail.limits as Record<WithdrawalMethod, MethodLimit>,
});

export const PAYMENT_RAILS: Record<CountryCode, CountryPaymentRail> = {
  IN: defineCountryRail({
    country: 'India',
    currency: 'INR',
    methods: ['UPI', 'BANK_TRANSFER', 'IMPS', 'NEFT'],
    defaultMethod: 'UPI',
    providers: {
      UPI: 'mock',
      BANK_TRANSFER: 'mock',
      IMPS: 'mock',
      NEFT: 'mock',
    },
    limits: {
      UPI: { min: 1, max: 100000 },
      BANK_TRANSFER: { min: 100, max: 500000 },
      IMPS: { min: 100, max: 200000 },
      NEFT: { min: 100, max: 500000 },
    },
  }),
  US: defineCountryRail({
    country: 'United States',
    currency: 'USD',
    methods: ['ACH', 'WIRE', 'ZELLE', 'BANK_TRANSFER'],
    defaultMethod: 'ACH',
    providers: {
      ACH: 'mock',
      WIRE: 'mock',
      ZELLE: 'mock',
      BANK_TRANSFER: 'mock',
    },
    limits: {
      ACH: { min: 1, max: 10000 },
      WIRE: { min: 50, max: 100000 },
      ZELLE: { min: 1, max: 2500 },
      BANK_TRANSFER: { min: 1, max: 10000 },
    },
  }),
  GB: defineCountryRail({
    country: 'United Kingdom',
    currency: 'GBP',
    methods: ['FASTER_PAYMENTS', 'BANK_TRANSFER'],
    defaultMethod: 'FASTER_PAYMENTS',
    providers: {
      FASTER_PAYMENTS: 'mock',
      BANK_TRANSFER: 'mock',
    },
    limits: {
      FASTER_PAYMENTS: { min: 1, max: 250000 },
      BANK_TRANSFER: { min: 1, max: 250000 },
    },
  }),
  EU: defineCountryRail({
    country: 'Europe',
    currency: 'EUR',
    methods: ['SEPA', 'SEPA_INSTANT', 'BANK_TRANSFER'],
    defaultMethod: 'SEPA',
    providers: {
      SEPA: 'mock',
      SEPA_INSTANT: 'mock',
      BANK_TRANSFER: 'mock',
    },
    limits: {
      SEPA: { min: 1, max: 100000 },
      SEPA_INSTANT: { min: 1, max: 100000 },
      BANK_TRANSFER: { min: 1, max: 100000 },
    },
  }),
  JP: defineCountryRail({
    country: 'Japan',
    currency: 'JPY',
    methods: ['ZENGIN', 'BANK_TRANSFER'],
    defaultMethod: 'ZENGIN',
    providers: {
      ZENGIN: 'mock',
      BANK_TRANSFER: 'mock',
    },
    limits: {
      ZENGIN: { min: 100, max: 10000000 },
      BANK_TRANSFER: { min: 100, max: 10000000 },
    },
  }),
  SG: defineCountryRail({
    country: 'Singapore',
    currency: 'SGD',
    methods: ['PAYNOW', 'FAST', 'BANK_TRANSFER'],
    defaultMethod: 'PAYNOW',
    providers: {
      PAYNOW: 'mock',
      FAST: 'mock',
      BANK_TRANSFER: 'mock',
    },
    limits: {
      PAYNOW: { min: 1, max: 200000 },
      FAST: { min: 1, max: 200000 },
      BANK_TRANSFER: { min: 1, max: 200000 },
    },
  }),
  AU: defineCountryRail({
    country: 'Australia',
    currency: 'AUD',
    methods: ['OSKO', 'NPP', 'BANK_TRANSFER'],
    defaultMethod: 'OSKO',
    providers: {
      OSKO: 'mock',
      NPP: 'mock',
      BANK_TRANSFER: 'mock',
    },
    limits: {
      OSKO: { min: 1, max: 100000 },
      NPP: { min: 1, max: 100000 },
      BANK_TRANSFER: { min: 1, max: 100000 },
    },
  }),
  CA: defineCountryRail({
    country: 'Canada',
    currency: 'CAD',
    methods: ['INTERAC', 'EFT', 'BANK_TRANSFER'],
    defaultMethod: 'INTERAC',
    providers: {
      INTERAC: 'mock',
      EFT: 'mock',
      BANK_TRANSFER: 'mock',
    },
    limits: {
      INTERAC: { min: 1, max: 10000 },
      EFT: { min: 1, max: 25000 },
      BANK_TRANSFER: { min: 1, max: 25000 },
    },
  }),
};

export const getPaymentRail = (countryCode: CountryCode) => PAYMENT_RAILS[countryCode];
