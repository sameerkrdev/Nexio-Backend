/**
 * Example usage of currency utilities
 *
 * This file demonstrates how phone numbers are mapped to currencies
 * during user signup.
 */

import { getCurrencyFromPhoneNumber, getCurrencySymbol, formatCurrency } from './currency';

// Example phone numbers and their detected currencies
const examples = [
  { phone: '+919876543210', country: 'India' },
  { phone: '+12025551234', country: 'United States' },
  { phone: '+14165551234', country: 'Canada' },
  { phone: '+819012345678', country: 'Japan' },
  { phone: '+33612345678', country: 'France' },
  { phone: '+4915112345678', country: 'Germany' },
  { phone: '+393401234567', country: 'Italy' },
  { phone: '+34612345678', country: 'Spain' },
  { phone: '+31612345678', country: 'Netherlands' },
];

console.log('📱 Phone Number → Currency Mapping Examples:\n');

examples.forEach(({ phone, country }) => {
  const currency = getCurrencyFromPhoneNumber(phone);
  const symbol = getCurrencySymbol(currency);
  const formatted = formatCurrency('1000', currency);

  console.log(`${country.padEnd(20)} ${phone.padEnd(18)} → ${currency} (${symbol}) → ${formatted}`);
});

console.log('\n💡 How it works during signup:');
console.log('1. User enters phone number: +919876543210');
console.log('2. System detects country code: +91');
console.log('3. Maps to currency: INR');
console.log('4. Creates wallet with currency: INR');
console.log('5. User receives payments in: ₹ (Indian Rupees)');

console.log('\n🌍 Supported Currencies:');
console.log('• INR (₹) - Indian Rupee - India (+91)');
console.log('• USD ($) - US Dollar - USA/Canada (+1)');
console.log('• JPY (¥) - Japanese Yen - Japan (+81)');
console.log('• EUR (€) - Euro - 19 Eurozone countries (+33, +49, +39, +34, etc.)');

console.log('\n⚠️  Default Behavior:');
console.log('• Unknown country codes default to USD');
console.log('• Invalid phone numbers default to USD');
