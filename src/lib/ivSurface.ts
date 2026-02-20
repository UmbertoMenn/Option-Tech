/**
 * IV Surface construction from market data.
 * Builds a grid of implied volatilities across strikes and expiries,
 * capturing the volatility smile/skew.
 */
import { impliedVolatility, riskFreeFromParity } from './blackScholes';

export interface IVPoint {
  strike: number;
  expiry: string; // YYYY-MM-DD
  iv: number;
  optionType: 'call' | 'put';
  volume?: number;
}

export interface IVSurface {
  points: IVPoint[];
  expiries: string[];
  riskFreeRate: number;
  getIV(strike: number, expiry: string, type: 'call' | 'put'): number;
}

interface OptionDataPoint {
  strike: number;
  expiry: string;
  type: 'call' | 'put';
  price: number; // EOD close or mid
  volume: number;
  bid?: number;
  ask?: number;
}

/**
 * Build IV surface from option data points and underlying price data.
 */
export function buildIVSurface(
  optionData: OptionDataPoint[],
  underlyingPriceByDate: Map<string, number>, // date -> close
  defaultRate: number = 0.045
): IVSurface {
  // Filter illiquid contracts
  const filtered = optionData.filter(d => {
    if (d.volume < 10) return false;
    if (d.bid !== undefined && d.ask !== undefined) {
      const mid = (d.bid + d.ask) / 2;
      if (mid > 0 && (d.ask - d.bid) / mid > 0.5) return false;
    }
    return d.price > 0;
  });

  // Try to derive risk-free rate from put-call parity on ATM pairs
  let riskFreeRate = defaultRate;
  const rateEstimates: number[] = [];

  // Group by expiry
  const byExpiry = new Map<string, OptionDataPoint[]>();
  for (const d of filtered) {
    if (!byExpiry.has(d.expiry)) byExpiry.set(d.expiry, []);
    byExpiry.get(d.expiry)!.push(d);
  }

  const expiries = Array.from(byExpiry.keys()).sort();

  for (const [expiry, points] of byExpiry) {
    // Find nearest ATM pair
    const latestDate = Array.from(underlyingPriceByDate.keys()).sort().pop();
    if (!latestDate) continue;
    const S = underlyingPriceByDate.get(latestDate);
    if (!S) continue;

    const calls = points.filter(p => p.type === 'call');
    const puts = points.filter(p => p.type === 'put');

    // Find strike closest to S
    let bestStrike = 0;
    let bestDist = Infinity;
    for (const c of calls) {
      const dist = Math.abs(c.strike - S);
      if (dist < bestDist) { bestDist = dist; bestStrike = c.strike; }
    }

    if (bestStrike > 0) {
      const call = calls.find(c => c.strike === bestStrike);
      const put = puts.find(p => p.strike === bestStrike);
      if (call && put) {
        const T = yearsBetween(latestDate, expiry);
        if (T > 0) {
          const r = riskFreeFromParity(S, bestStrike, T, call.price, put.price);
          if (r > -0.05 && r < 0.15) rateEstimates.push(r);
        }
      }
    }
  }

  if (rateEstimates.length > 0) {
    riskFreeRate = rateEstimates.reduce((a, b) => a + b, 0) / rateEstimates.length;
  }

  // Calculate IV for each point
  const ivPoints: IVPoint[] = [];
  const latestDate = Array.from(underlyingPriceByDate.keys()).sort().pop();
  const S = latestDate ? underlyingPriceByDate.get(latestDate) : undefined;

  if (S) {
    for (const d of filtered) {
      const T = yearsBetween(latestDate!, d.expiry);
      if (T <= 0) continue;

      const iv = impliedVolatility(d.price, S, d.strike, T, riskFreeRate, d.type);
      if (!isNaN(iv) && iv > 0.01 && iv < 5) {
        ivPoints.push({
          strike: d.strike,
          expiry: d.expiry,
          iv,
          optionType: d.type,
          volume: d.volume,
        });
      }
    }
  }

  return {
    points: ivPoints,
    expiries,
    riskFreeRate,
    getIV: (strike: number, expiry: string, type: 'call' | 'put') =>
      interpolateIV(ivPoints, strike, expiry, type),
  };
}

/**
 * Interpolate IV for a given strike/expiry/type from the surface points.
 * Uses bilinear interpolation across strike and expiry dimensions.
 */
function interpolateIV(points: IVPoint[], strike: number, expiry: string, type: 'call' | 'put'): number {
  // Filter by type
  const typePoints = points.filter(p => p.optionType === type);
  if (typePoints.length === 0) {
    // Fallback to any type
    const allPoints = points;
    if (allPoints.length === 0) return 0.3; // default
    return interpolateFromPoints(allPoints, strike, expiry);
  }
  return interpolateFromPoints(typePoints, strike, expiry);
}

function interpolateFromPoints(points: IVPoint[], strike: number, expiry: string): number {
  // Get unique expiries sorted
  const expiries = [...new Set(points.map(p => p.expiry))].sort();
  
  if (expiries.length === 0) return 0.3;

  // Find bracketing expiries
  let expiryIdx = expiries.findIndex(e => e >= expiry);
  if (expiryIdx === -1) expiryIdx = expiries.length - 1;

  // Interpolate within the nearest expiry(ies)
  if (expiryIdx === 0 || expiries[expiryIdx] === expiry) {
    return interpolateByStrike(points.filter(p => p.expiry === expiries[expiryIdx]), strike);
  }

  // Bilinear: interpolate by strike for both bracketing expiries, then interpolate by time
  const e1 = expiries[expiryIdx - 1];
  const e2 = expiries[expiryIdx];
  const iv1 = interpolateByStrike(points.filter(p => p.expiry === e1), strike);
  const iv2 = interpolateByStrike(points.filter(p => p.expiry === e2), strike);

  const t1 = new Date(e1).getTime();
  const t2 = new Date(e2).getTime();
  const t = new Date(expiry).getTime();

  if (t2 === t1) return iv1;
  const w = (t - t1) / (t2 - t1);
  return iv1 + w * (iv2 - iv1);
}

function interpolateByStrike(points: IVPoint[], strike: number): number {
  if (points.length === 0) return 0.3;
  if (points.length === 1) return points[0].iv;

  const sorted = [...points].sort((a, b) => a.strike - b.strike);

  // Below range
  if (strike <= sorted[0].strike) return sorted[0].iv;
  // Above range
  if (strike >= sorted[sorted.length - 1].strike) return sorted[sorted.length - 1].iv;

  // Find bracketing strikes
  for (let i = 0; i < sorted.length - 1; i++) {
    if (strike >= sorted[i].strike && strike <= sorted[i + 1].strike) {
      const w = (strike - sorted[i].strike) / (sorted[i + 1].strike - sorted[i].strike);
      return sorted[i].iv + w * (sorted[i + 1].iv - sorted[i].iv);
    }
  }

  return sorted[0].iv;
}

function yearsBetween(fromDate: string, toDate: string): number {
  const d1 = new Date(fromDate);
  const d2 = new Date(toDate);
  return (d2.getTime() - d1.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

/**
 * Build option data points from option chain snapshot results.
 */
export function snapshotToDataPoints(
  snapshots: Array<{
    strike_price: number;
    contract_type: 'call' | 'put';
    expiration_date: string;
    day?: { close: number; volume: number };
    last_quote?: { bid: number; ask: number; midpoint: number };
  }>
): Array<{
  strike: number;
  expiry: string;
  type: 'call' | 'put';
  price: number;
  volume: number;
  bid?: number;
  ask?: number;
}> {
  return snapshots
    .filter(s => s.day || s.last_quote)
    .map(s => ({
      strike: s.strike_price,
      expiry: s.expiration_date,
      type: s.contract_type,
      price: s.last_quote?.midpoint || s.day?.close || 0,
      volume: s.day?.volume || 0,
      bid: s.last_quote?.bid,
      ask: s.last_quote?.ask,
    }));
}
