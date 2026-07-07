import { Position } from '@/types/portfolio';
import { ParsedOrder, toIsoDateFromIT } from '@/lib/orderFileParser';
import { getOptionExpirationDate } from '@/lib/optionExpiry';

/**
 * Build an OptionStrat URL for a strategy.
 * 
 * URL format: https://optionstrat.com/build/{strategy-type}/{TICKER}/{legs}
 * Leg format: .{TICKER}{YYMMDD}{P/C}{STRIKE}@{PRICE}
 * Sold legs are prefixed with `-`
 * Expiry date is always the 3rd Friday of the expiry month (holiday-adjusted,
 * vedi src/lib/optionExpiry.ts).
 */

// Format expiry date as YYMMDD (options expiration, holiday-adjusted)
function formatExpiry(date: string | null | undefined): string {
  if (!date) return '000000';
  const d = new Date(date);
  const exp = getOptionExpirationDate(d.getFullYear(), d.getMonth());
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
  const qty = option.quantity;
  const absQty = Math.abs(qty);
  const type = option.option_type === 'call' ? 'C' : 'P';
  const expiry = formatExpiry(option.expiry_date);
  const strike = formatStrike(option.strike_price);
  const price = formatStrike(option.avg_cost || option.current_price);

  if (absQty === 1) {
    const prefix = qty < 0 ? '-' : '';
    return `${prefix}.${ticker}${expiry}${type}${strike}@${price}`;
  }
  const qtySuffix = `x${qty}`;
  return `.${ticker}${expiry}${type}${strike}${qtySuffix}@${price}`;
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
 * Convert expiryDate (DD/MM/YYYY from Excel) to YYMMDD using getOptionExpirationDate.
 */
function expiryDateToYYMMDD(expiryDate: string | undefined): string {
  if (!expiryDate) return '000000';
  const iso = toIsoDateFromIT(expiryDate);
  if (!iso) return '000000';
  const d = new Date(iso);
  const exp = getOptionExpirationDate(d.getFullYear(), d.getMonth());
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
  // Reverse to chronological order (oldest first)
  const chronological = [...orders].reverse();

  // Group by symbol
  const groups = new Map<string, ParsedOrder[]>();
  for (const order of chronological) {
    const key = order.symbol;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(order);
  }

  const legs: string[] = [];

  for (const [, group] of groups) {
    // Handle assignments before expansion (preserve original quantity)
    const assignmentOrders = group.filter(o => o.isAssignment && o.assignmentStrike);
    const nonAssignmentOrders = group.filter(o => !(o.isAssignment && o.assignmentStrike));

    for (const order of assignmentOrders) {
      const buyPrice = formatStrike(order.assignmentStrike);
      const sellPrice = formatStrike(order.avgPrice);
      legs.push(`${ticker}x${order.quantity}@${buyPrice}@${sellPrice}`);

      // Close the assigned PUT at price 0
      if (order.assignmentPutSymbol) {
        const putParsed = parseSymbolTypeAndStrike(order.assignmentPutSymbol);
        if (putParsed) {
          const putExpiry = expiryDateToYYMMDD(order.expiryDate);
          // Find the original sell price of this PUT from the orders
          const putSellOrder = chronological.find(
            o => o.symbol === order.assignmentPutSymbol && o.operation === 'sell' && o.optionType === 'PUT'
          );
          const putOpenPrice = putSellOrder ? formatStrike(putSellOrder.avgPrice) : '0';
          legs.push(`-.${ticker}${putExpiry}${putParsed.type}${formatStrike(putParsed.strike)}@${putOpenPrice}@0`);
        }
      }
    }

    // Expand only non-assignment orders for FIFO matching
    const expanded: ParsedOrder[] = [];
    for (const order of nonAssignmentOrders) {
      for (let i = 0; i < order.quantity; i++) {
        expanded.push({ ...order, quantity: 1 });
      }
    }

    // FIFO matching on expanded (all qty=1)
    const remaining = [...expanded];

    while (remaining.length > 0) {
      const opening = remaining.shift()!;

      const parsed = parseSymbolTypeAndStrike(opening.symbol);
      if (!parsed) continue;

      const expiry = expiryDateToYYMMDD(opening.expiryDate);
      const isSold = opening.operation === 'sell';
      const prefix = isSold ? '-' : '';
      const openPrice = formatStrike(opening.avgPrice);

      // Look for closing trade (opposite direction)
      const oppositeOp = isSold ? 'buy' : 'sell';
      const closeIdx = remaining.findIndex(o => o.operation === oppositeOp);

      let leg = `${prefix}.${ticker}${expiry}${parsed.type}${formatStrike(parsed.strike)}@${openPrice}`;

      if (closeIdx !== -1) {
        const closing = remaining.splice(closeIdx, 1)[0];
        const closePrice = formatStrike(closing.avgPrice);
        leg += `@${closePrice}`;
      }

      legs.push(leg);
    }
  }

  // Re-aggregate identical consecutive open legs (same text) into xN suffix
  const aggregated: string[] = [];
  for (const leg of legs) {
    if (aggregated.length > 0) {
      const prev = aggregated[aggregated.length - 1];
      // Extract base (without xN) for comparison
      const prevBase = prev.replace(/x-?\d+(@)/, '$1');
      const curBase = leg;
      if (prevBase === curBase && !leg.includes('@', leg.indexOf('@') + 1)) {
        // Same open leg — merge by adding/incrementing xN
        const xMatch = prev.match(/x(-?\d+)@/);
        if (xMatch) {
          const count = parseInt(xMatch[1]);
          const newCount = count < 0 ? count - 1 : count + 1;
          aggregated[aggregated.length - 1] = prev.replace(/x-?\d+@/, `x${newCount}@`);
        } else {
          // First duplication: insert x2 or x-2
          const isSoldLeg = prev.startsWith('-');
          const qty = isSoldLeg ? 'x-2' : 'x2';
          const atIdx = prev.indexOf('@');
          aggregated[aggregated.length - 1] = prev.slice(0, atIdx) + qty + prev.slice(atIdx);
        }
        continue;
      }
    }
    aggregated.push(leg);
  }

  const slug = (strategyName && STRATEGY_SLUG_MAP[strategyName]) || 'custom';
  return `https://optionstrat.com/build/${slug}/${ticker}/${aggregated.join(',')}`;
}
