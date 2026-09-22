import { formatDistanceToNow } from 'date-fns';
import { it } from 'date-fns/locale';

export function formatEUR(value: number): string {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// Valid ISO 4217 currency codes we support
const VALID_CURRENCIES = new Set([
  'EUR', 'USD', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'CNY', 'HKD', 'KRW', 
  'TWD', 'INR', 'BRL', 'MXN', 'SGD', 'SEK', 'NOK', 'DKK', 'NZD', 'ZAR',
  'RUB', 'ILS', 'PLN', 'CZK', 'HUF', 'TRY', 'THB', 'MYR', 'IDR', 'PHP', 'VND'
]);

export function formatCurrency(value: number, currency: string = 'EUR'): string {
  // Handle non-standard currency codes (like "OTHER")
  if (!currency || !VALID_CURRENCIES.has(currency)) {
    const formatted = new Intl.NumberFormat('it-IT', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
    return `${formatted} ${currency || '?'}`;
  }

  if (currency === 'USD') {
    // Format with Italian number style but $ symbol after
    const formatted = new Intl.NumberFormat('it-IT', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
    return `${formatted} $`;
  }
  
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: number, decimals: number = 2): string {
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatPercentage(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${formatNumber(value, 2)}%`;
}

export function formatProfitLoss(value: number, currency: string = 'EUR'): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${formatCurrency(value, currency)}`;
}

export function formatDate(date: string | Date): string {
  const d = new Date(date);
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

export function formatRelativeTime(date: string | Date): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: it });
}

export function parseExcelNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  
  if (typeof value === 'number') return value;
  
  // Handle Italian number format (1.234,56 -> 1234.56)
  const cleaned = value
    .toString()
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export function parseExcelDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  
  // Handle Excel date serial number
  if (typeof value === 'number') {
    const date = new Date((value - 25569) * 86400 * 1000);
    return date.toISOString().split('T')[0];
  }
  
  // Handle DD/MM/YYYY format
  const match = value.toString().match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}`;
  }
  
  return null;
}
/**
 * Numero digitato a mano: accetta sia la virgola sia il punto come separatore
 * decimale ("8,30", "8.30"). Se compaiono entrambi, l'ultimo è il decimale e
 * l'altro è il separatore delle migliaia ("1.234,56", "1,234.56").
 * Ritorna null se il testo non è un numero.
 */
export function parseDecimalInput(value: string): number | null {
  const text = value.trim().replace(/\s+/g, '');
  if (!text) return null;
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  let normalized = text;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    normalized = text.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma >= 0) {
    normalized = text.replace(',', '.');
  }
  if (!/^[-+]?\d*\.?\d+$|^[-+]?\d+\.$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
