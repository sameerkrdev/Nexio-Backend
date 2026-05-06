/**
 * Currency utility functions
 */

export type FiatCurrency = 'INR' | 'USD' | 'JPY' | 'EUR';

interface CountryCodeMapping {
  code: string;
  currency: FiatCurrency;
  region: string;
}

/**
 * Mapping of country calling codes to currencies
 * Format: +{code} → currency
 */
const COUNTRY_CODE_TO_CURRENCY: CountryCodeMapping[] = [
  // India
  { code: '+91', currency: 'INR', region: 'India' },

  // United States & Canada
  { code: '+1', currency: 'USD', region: 'North America' },

  // Japan
  { code: '+81', currency: 'JPY', region: 'Japan' },

  // Eurozone countries (using Euro)
  { code: '+33', currency: 'EUR', region: 'France' },
  { code: '+49', currency: 'EUR', region: 'Germany' },
  { code: '+39', currency: 'EUR', region: 'Italy' },
  { code: '+34', currency: 'EUR', region: 'Spain' },
  { code: '+31', currency: 'EUR', region: 'Netherlands' },
  { code: '+32', currency: 'EUR', region: 'Belgium' },
  { code: '+43', currency: 'EUR', region: 'Austria' },
  { code: '+351', currency: 'EUR', region: 'Portugal' },
  { code: '+353', currency: 'EUR', region: 'Ireland' },
  { code: '+358', currency: 'EUR', region: 'Finland' },
  { code: '+30', currency: 'EUR', region: 'Greece' },
  { code: '+352', currency: 'EUR', region: 'Luxembourg' },
  { code: '+386', currency: 'EUR', region: 'Slovenia' },
  { code: '+370', currency: 'EUR', region: 'Lithuania' },
  { code: '+371', currency: 'EUR', region: 'Latvia' },
  { code: '+372', currency: 'EUR', region: 'Estonia' },
  { code: '+421', currency: 'EUR', region: 'Slovakia' },
  { code: '+357', currency: 'EUR', region: 'Cyprus' },
  { code: '+356', currency: 'EUR', region: 'Malta' },
];

/**
 * Determines the fiat currency based on phone number country code
 * @param phoneNumber - E.164 formatted phone number (e.g., +919876543210)
 * @returns FiatCurrency - INR, USD, JPY, or EUR (defaults to USD if unknown)
 */
export const getCurrencyFromPhoneNumber = (phoneNumber: string): FiatCurrency => {
  if (!phoneNumber || !phoneNumber.startsWith('+')) {
    return 'USD'; // Default fallback
  }

  // Sort by code length (descending) to match longer codes first
  // This ensures +351 (Portugal) is matched before +35 (invalid)
  const sortedMappings = [...COUNTRY_CODE_TO_CURRENCY].sort(
    (a, b) => b.code.length - a.code.length,
  );

  for (const mapping of sortedMappings) {
    if (phoneNumber.startsWith(mapping.code)) {
      return mapping.currency;
    }
  }

  // Default to USD for unknown country codes
  return 'USD';
};

/**
 * Get currency symbol for display
 */
export const getCurrencySymbol = (currency: FiatCurrency): string => {
  const symbols: Record<FiatCurrency, string> = {
    INR: '₹',
    USD: '$',
    JPY: '¥',
    EUR: '€',
  };
  return symbols[currency];
};

/**
 * Get currency name
 */
export const getCurrencyName = (currency: FiatCurrency): string => {
  const names: Record<FiatCurrency, string> = {
    INR: 'Indian Rupee',
    USD: 'US Dollar',
    JPY: 'Japanese Yen',
    EUR: 'Euro',
  };
  return names[currency];
};

/**
 * Format amount with currency
 */
export const formatCurrency = (amount: string | number, currency: FiatCurrency): string => {
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  const symbol = getCurrencySymbol(currency);

  // JPY doesn't use decimal places
  if (currency === 'JPY') {
    return `${symbol}${Math.round(numAmount).toLocaleString()}`;
  }

  return `${symbol}${numAmount.toFixed(2).toLocaleString()}`;
};
