import { Position } from '@/types/portfolio';

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

// Format expiry date as YYMMDD (3rd Friday of the month)
function formatExpiry(date: string | null | undefined): string {
  if (!date) return '000000';
  const d = new Date(date);
  const tf = thirdFriday(d.getFullYear(), d.getMonth());
  const yy = String(tf.getFullYear()).slice(-2);
  const mm = String(tf.getMonth() + 1).padStart(2, '0');
  const dd = String(tf.getDate()).padStart(2, '0');
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
  const price = formatStrike(option.current_price || option.avg_cost);
  
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
