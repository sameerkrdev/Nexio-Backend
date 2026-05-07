import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { CountryCode } from '../generated/prisma/client';
import logger from '../config/logger.config';

const EU_COUNTRY_CODES = new Set([
  'DE',
  'FR',
  'ES',
  'IT',
  'NL',
  'BE',
  'AT',
  'PT',
  'FI',
  'IE',
  'GR',
]);

const SUPPORTED_COUNTRIES = new Set(['IN', 'US', 'GB', 'JP', 'SG', 'AU', 'CA']);

const maskPhoneForLogs = (phoneNumber: string) => {
  const digits = phoneNumber.replace(/\D/g, '');
  return digits.length <= 4 ? digits : digits.slice(-4);
};

export const detectCountryFromPhone = (phoneNumber: string): CountryCode => {
  try {
    const parsed = parsePhoneNumberFromString(phoneNumber);
    const region = parsed?.country;
    if (!region) {
      throw new Error('Phone region could not be determined');
    }

    if (EU_COUNTRY_CODES.has(region)) {
      return 'EU';
    }

    if (SUPPORTED_COUNTRIES.has(region)) {
      return region as CountryCode;
    }

    logger.warn('Unsupported phone country detected, falling back to US', {
      phoneLast4: maskPhoneForLogs(phoneNumber),
      country: region,
    });
    return 'US';
  } catch {
    logger.warn('Failed to parse phone country, falling back to US', {
      phoneLast4: maskPhoneForLogs(phoneNumber),
    });
    return 'US';
  }
};
