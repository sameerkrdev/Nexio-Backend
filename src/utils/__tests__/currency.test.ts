import { describe, expect, test } from 'bun:test';
import { getCurrencyFromPhoneNumber, getCurrencySymbol, formatCurrency } from '../currency';

describe('Currency Utils', () => {
  describe('getCurrencyFromPhoneNumber', () => {
    test('should return INR for Indian phone numbers', () => {
      expect(getCurrencyFromPhoneNumber('+919876543210')).toBe('INR');
      expect(getCurrencyFromPhoneNumber('+911234567890')).toBe('INR');
    });

    test('should return USD for US/Canada phone numbers', () => {
      expect(getCurrencyFromPhoneNumber('+12025551234')).toBe('USD');
      expect(getCurrencyFromPhoneNumber('+14165551234')).toBe('USD');
    });

    test('should return JPY for Japanese phone numbers', () => {
      expect(getCurrencyFromPhoneNumber('+819012345678')).toBe('JPY');
      expect(getCurrencyFromPhoneNumber('+818012345678')).toBe('JPY');
    });

    test('should return EUR for Eurozone phone numbers', () => {
      expect(getCurrencyFromPhoneNumber('+33612345678')).toBe('EUR'); // France
      expect(getCurrencyFromPhoneNumber('+4915112345678')).toBe('EUR'); // Germany
      expect(getCurrencyFromPhoneNumber('+393401234567')).toBe('EUR'); // Italy
      expect(getCurrencyFromPhoneNumber('+34612345678')).toBe('EUR'); // Spain
      expect(getCurrencyFromPhoneNumber('+31612345678')).toBe('EUR'); // Netherlands
    });

    test('should return USD for unknown country codes', () => {
      expect(getCurrencyFromPhoneNumber('+441234567890')).toBe('USD'); // UK (not in mapping)
      expect(getCurrencyFromPhoneNumber('+861234567890')).toBe('USD'); // China (not in mapping)
    });

    test('should return USD for invalid phone numbers', () => {
      expect(getCurrencyFromPhoneNumber('')).toBe('USD');
      expect(getCurrencyFromPhoneNumber('1234567890')).toBe('USD'); // Missing +
      expect(getCurrencyFromPhoneNumber('invalid')).toBe('USD');
    });

    test('should match longer country codes first', () => {
      // +351 (Portugal) should match before +35 (invalid)
      expect(getCurrencyFromPhoneNumber('+351912345678')).toBe('EUR');
    });
  });

  describe('getCurrencySymbol', () => {
    test('should return correct symbols', () => {
      expect(getCurrencySymbol('INR')).toBe('₹');
      expect(getCurrencySymbol('USD')).toBe('$');
      expect(getCurrencySymbol('JPY')).toBe('¥');
      expect(getCurrencySymbol('EUR')).toBe('€');
    });
  });

  describe('formatCurrency', () => {
    test('should format INR with 2 decimals', () => {
      expect(formatCurrency('1000.50', 'INR')).toBe('₹1000.50');
      expect(formatCurrency(1000.5, 'INR')).toBe('₹1000.50');
    });

    test('should format USD with 2 decimals', () => {
      expect(formatCurrency('100.99', 'USD')).toBe('$100.99');
    });

    test('should format JPY without decimals', () => {
      expect(formatCurrency('1000.99', 'JPY')).toBe('¥1,001');
      expect(formatCurrency(1000.5, 'JPY')).toBe('¥1,001');
    });

    test('should format EUR with 2 decimals', () => {
      expect(formatCurrency('500.75', 'EUR')).toBe('€500.75');
    });
  });
});
