import { Position } from '@/types/portfolio';
import { ParsedOrder, toIsoDateFromIT } from '@/lib/orderFileParser';

/**
 * Build an OptionStrat URL for a strategy.
 * 
 * URL format: https://optionstrat.com/build/{strategy-type}/{TICKER}/{legs}
 * Leg format: .{TICKER}{YYMMDD}{P/C}{STRIKE}@{PRICE}
 * Sold legs are prefixed with `-`
 * Expiry date is always the 3rd Friday of the expiry month.
 */

// Calculate the 3rd Friday of a given month
function thirdFriday(year: number, month: number): Date {
  const first = new Date(year, month, 1);
  const dayOfWeek = first.getDay();
  const firstFriday = 1 + ((5 - dayOfWeek + 7) % 7);
  return new Date(year, month, firstFriday + 14);
}

// Easter Sunday using the Anonymous Gregorian algorithm (Computus)
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

// Observed date for a fixed holiday: Fri if falls on Sat, Mon if falls on Sun
function observedDate(year: number, month: number, day: number): Date {
  const d = new Date(year, month, day);
  const dow = d.getDay();
  if (dow === 6) d.setDate(day - 1); // Saturday -> Friday
  if (dow === 0) d.setDate(day + 1); // Sunday -> Monday
  return d;
}

// Check if a date is a US stock market holiday
function isUSMarketHoliday(date: Date): boolean {
  const year = date.getFullYear();
  const time = date.getTime();

  const holidays: Date[] = [
    observedDate(year, 0, 1),   // New Year's Day
    observedDate(year, 5, 19),  // Juneteenth
    observedDate(year, 6, 4),   // Independence Day
    observedDate(year, 11, 25), // Christmas
  ];

  // Good Friday (2 days before Easter Sunday)
  const easter = easterSunday(year);
  const goodFriday = new Date(easter);
  goodFriday.setDate(easter.getDate() - 2);
  holidays.push(goodFriday);

  // Thanksgiving: 4th Thursday of November
  const nov1 = new Date(year, 10, 1);
  const nov1Dow = nov1.getDay();
  const firstThu = 1 + ((4 - nov1Dow + 7) % 7);
  holidays.push(new Date(year, 10, firstThu + 21));

  // MLK Day: 3rd Monday Jan
  const jan1 = new Date(year, 0, 1);
  const firstMonJan = 1 + ((1 - jan1.getDay() + 7) % 7);
  holidays.push(new Date(year, 0, firstMonJan + 14));

  // Presidents' Day: 3rd Monday Feb
  const feb1 = new Date(year, 1, 1);
  const firstMonFeb = 1 + ((1 - feb1.getDay() + 7) % 7);
  holidays.push(new Date(year, 1, firstMonFeb + 14));

  // Memorial Day: last Monday May
  const may31 = new Date(year, 4, 31);
  const lastMonMay = 31 - ((may31.getDay() - 1 + 7) % 7);
  holidays.push(new Date(year, 4, lastMonMay));

  // Labor Day: 1st Monday Sep
  const sep1 = new Date(year, 8, 1);
  const firstMonSep = 1 + ((1 - sep1.getDay() + 7) % 7);
  holidays.push(new Date(year, 8, firstMonSep));

  return holidays.some(h =>
    h.getFullYear() === date.getFullYear() &&
    h.getMonth() === date.getMonth() &&
    h.getDate() === date.getDate()
  );
}

// Get options expiration date adjusting for holidays
function optionsExpirationDate(year: number, month: number): Date {
  const tf = thirdFriday(year, month);

  if (isUSMarketHoliday(tf)) {
    const thursday = new Date(tf);
    thursday.setDate(tf.getDate() - 1);
    if (isUSMarketHoliday(thursday)) {
      // Both Thu+Fri are holidays -> Monday after
      const monday = new Date(tf);
      monday.setDate(tf.getDate() + 3);
      return monday;
    }
    return thursday;
  }
  return tf;
}

// Format expiry date as YYMMDD (options expiration, holiday-adjusted)
function formatExpiry(date: string | null | undefined): string {
  if (!date) return '000000';
  const d = new Date(date);
  const exp = optionsExpirationDate(d.getFullYear(), d.getMonth());
  const yy = String(exp.getFullYear()).slice(-2);
  const mm = String(exp.getMonth() + 1).padStart(2, '0');
  const dd = String(exp.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

// Format strike price (remove unnecessary trailing zeros)
function formatStrike(strike: number | null | undefined): string {
  if (!strike) return '0';
  return String(parseFloat(strike.toFixed(2)));
}

// Format a single leg
function formatLeg(ticker: string, option: Position): string {
  const isSold = option.quantity < 0;
  const type = option.option_type === 'call' ? 'C' : 'P';
  const expiry = formatExpiry(option.expiry_date);
  const strike = formatStrike(option.strike_price);
  const price = formatStrike(option.avg_cost || option.current_price);
  
  const prefix = isSold ? '-' : '';
  return `${prefix}.${ticker}${expiry}${type}${strike}@${price}`;
}

// Map internal strategy names to OptionStrat URL slugs
const STRATEGY_SLUG_MAP: Record<string, string> = {
  'Short Strangle': 'short-strangle',
  'Long Strangle': 'long-strangle',
  'Short Straddle': 'short-straddle',
  'Long Straddle': 'long-straddle',
  'Diagonal Put Spread': 'diagonal-put-spread',
  'Diagonal Call Spread': 'diagonal-call-spread',
  'Bull Call Spread': 'bull-call-spread',
  'Bear Call Spread': 'bear-call-spread',
  'Bear Put Spread': 'bear-put-spread',
  'Bull Put Spread': 'bull-put-spread',
  'Calendar Call Spread': 'calendar-call-spread',
  'Calendar Put Spread': 'calendar-put-spread',
  'Collar': 'collar',
  'Long Put Butterfly': 'long-put-butterfly',
  'Long Call Butterfly': 'long-call-butterfly',
  'Short Put Butterfly': 'short-put-butterfly',
  'Put Broken Wing Butterfly': 'put-broken-wing',
  'Call Broken Wing Butterfly': 'call-broken-wing',
  'Iron Condor': 'iron-condor',
  'Double Diagonal': 'double-diagonal',
};

interface BuildUrlParams {
  strategyType: string;
  ticker: string;
  legs: Position[];
}

export function buildOptionStratUrl({ strategyType, ticker, legs }: BuildUrlParams): string {
  const formattedLegs = legs.map(leg => formatLeg(ticker, leg)).join(',');
  return `https://optionstrat.com/build/${strategyType}/${ticker}/${formattedLegs}`;
}

// Convenience builders

export function buildIronCondorUrl(
  ticker: string,
  boughtPut: Position,
  soldPut: Position,
  soldCall: Position,
  boughtCall: Position
): string {
  return buildOptionStratUrl({
    strategyType: 'iron-condor',
    ticker,
    legs: [boughtPut, soldPut, soldCall, boughtCall],
  });
}

export function buildDoubleDiagonalUrl(
  ticker: string,
  soldPut: Position,
  boughtPut: Position,
  soldCall: Position,
  boughtCall: Position
): string {
  return buildOptionStratUrl({
    strategyType: 'double-diagonal',
    ticker,
    legs: [boughtPut, soldPut, soldCall, boughtCall],
  });
}

export function buildCoveredCallUrl(ticker: string, option: Position): string {
  const stockLeg = `${ticker}x100`;
  const optionLeg = formatLeg(ticker, option);
  return `https://optionstrat.com/build/covered-call/${ticker}/${stockLeg},${optionLeg}`;
}

export function buildNakedPutUrl(ticker: string, option: Position): string {
  return buildOptionStratUrl({
    strategyType: 'cash-secured-put',
    ticker,
    legs: [option],
  });
}

export function buildLeapCallUrl(ticker: string, option: Position): string {
  return buildOptionStratUrl({
    strategyType: 'long-call',
    ticker,
    legs: [option],
  });
}

export function buildLongPutUrl(ticker: string, option: Position): string {
  return buildOptionStratUrl({
    strategyType: 'long-put',
    ticker,
    legs: [option],
  });
}

export function buildGroupedStrategyUrl(
  ticker: string,
  options: Position[],
  strategyName: string | null
): string {
  const strategyType = (strategyName && STRATEGY_SLUG_MAP[strategyName]) || 'custom';
  return buildOptionStratUrl({
    strategyType,
    ticker,
    legs: options,
  });
}

// --- Advanced: build URL from parsed orders (calculator) ---

/**
 * Extract option type (C/P) and strike from symbol.
 * E.g. "CLSG6P90" -> { type: 'P', strike: 90 }
 * Pattern: TICKER + monthCode + yearDigit + C/P + strike
 */
function parseSymbolTypeAndStrike(symbol: string): { type: 'C' | 'P'; strike: number } | null {
  // Match: any letters, then a letter (month), digit (year), then C or P, then strike number
  const match = symbol.match(/[A-Z]+[A-Z]\d([CP])([\d.]+)$/i);
  if (!match) return null;
  return {
    type: match[1].toUpperCase() as 'C' | 'P',
    strike: parseFloat(match[2]),
  };
}

/**
 * Convert expiryDate (DD/MM/YYYY from Excel) to YYMMDD using optionsExpirationDate.
 */
function expiryDateToYYMMDD(expiryDate: string | undefined): string {
  if (!expiryDate) return '000000';
  const iso = toIsoDateFromIT(expiryDate);
  if (!iso) return '000000';
  const d = new Date(iso);
  const exp = optionsExpirationDate(d.getFullYear(), d.getMonth());
  const yy = String(exp.getFullYear()).slice(-2);
  const mm = String(exp.getMonth() + 1).padStart(2, '0');
  const dd = String(exp.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

/**
 * Build an OptionStrat URL from parsed calculator orders.
 * 
 * Orders are in reverse chronological order (newest first).
 * For each symbol group: last in array = opening trade, first = closing trade.
 */
export function buildOptionStratUrlFromOrders(
  orders: ParsedOrder[],
  ticker: string,
  strategyName: string | null
): string {
  // Group orders by symbol
  const groups = new Map<string, ParsedOrder[]>();
  for (const order of orders) {
    const key = order.symbol;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(order);
  }

  const legs: string[] = [];

  for (const [, group] of groups) {
    // Last in array = opening trade (oldest), first = closing trade (newest)
    const openingTrade = group[group.length - 1];
    const closingTrade = group.length > 1 ? group[0] : null;

    const parsed = parseSymbolTypeAndStrike(openingTrade.symbol);
    if (!parsed) continue;

    const expiry = expiryDateToYYMMDD(openingTrade.expiryDate);
    const isSold = openingTrade.operation === 'sell';
    const prefix = isSold ? '-' : '';
    const qty = openingTrade.quantity;
    const qtyDisplay = isSold ? -qty : qty;
    const openPrice = formatStrike(openingTrade.avgPrice);

    let leg = `${prefix}.${ticker}${expiry}${parsed.type}${formatStrike(parsed.strike)}x${qtyDisplay}@${openPrice}`;

    if (closingTrade) {
      const closePrice = formatStrike(closingTrade.avgPrice);
      leg += `@${closePrice}`;
    }

    legs.push(leg);
  }

  const slug = (strategyName && STRATEGY_SLUG_MAP[strategyName]) || 'custom';
  return `https://optionstrat.com/build/${slug}/${ticker}/${legs.join(',')}`;
}
