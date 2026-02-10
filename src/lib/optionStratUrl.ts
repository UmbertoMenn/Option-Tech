import { Position } from '@/types/portfolio';

/**
 * Build an OptionStrat URL for a strategy.
 * 
 * URL format: https://optionstrat.com/build/{strategy-type}/{TICKER}/{legs}
 * Leg format: .{TICKER}{YYMMDD}{P/C}{STRIKE}@{PRICE}
 * Sold legs are prefixed with `-`
 */

// Format expiry date as YYMMDD
function formatExpiry(date: string | null | undefined): string {
  if (!date) return '000000';
  const d = new Date(date);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

// Format strike price (remove unnecessary trailing zeros)
function formatStrike(strike: number | null | undefined): string {
  if (!strike) return '0';
  // Use parseFloat to strip trailing zeros
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

export type OptionStratStrategy = 
  | 'iron-condor'
  | 'covered-call'
  | 'short-put'
  | 'long-call'
  | 'long-put'
  | 'custom';

interface BuildUrlParams {
  strategyType: OptionStratStrategy;
  ticker: string;
  legs: Position[];
}

export function buildOptionStratUrl({ strategyType, ticker, legs }: BuildUrlParams): string {
  const formattedLegs = legs.map(leg => formatLeg(ticker, leg)).join(',');
  return `https://optionstrat.com/build/${strategyType}/${ticker}/${formattedLegs}`;
}

// Convenience builders for each strategy type

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
    strategyType: 'custom',
    ticker,
    legs: [boughtPut, soldPut, soldCall, boughtCall],
  });
}

export function buildCoveredCallUrl(ticker: string, option: Position): string {
  return buildOptionStratUrl({
    strategyType: 'covered-call',
    ticker,
    legs: [option],
  });
}

export function buildNakedPutUrl(ticker: string, option: Position): string {
  return buildOptionStratUrl({
    strategyType: 'short-put',
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
  // Map known strategy names to OptionStrat types
  let strategyType: OptionStratStrategy = 'custom';
  if (strategyName === 'Short Strangle') strategyType = 'custom';
  else if (strategyName === 'Put Spread' || strategyName === 'Diagonal Put Spread') strategyType = 'custom';
  else if (strategyName === 'Call Spread' || strategyName === 'Diagonal Call Spread') strategyType = 'custom';
  
  return buildOptionStratUrl({
    strategyType,
    ticker,
    legs: options,
  });
}
