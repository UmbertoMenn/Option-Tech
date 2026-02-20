/**
 * Black-Scholes pricing engine with Greeks and inverse IV calculation.
 */

// Standard normal CDF (Abramowitz-Stegun approximation)
export function cdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);
  return 0.5 * (1.0 + sign * y);
}

// Standard normal PDF
export function pdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// d1 and d2 helpers
function d1(S: number, K: number, T: number, r: number, sigma: number): number {
  return (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
}

function d2(S: number, K: number, T: number, r: number, sigma: number): number {
  return d1(S, K, T, r, sigma) - sigma * Math.sqrt(T);
}

/**
 * Black-Scholes price for European call/put.
 * S: spot price, K: strike, T: time to expiry (years), r: risk-free rate, sigma: volatility
 */
export function bsPrice(S: number, K: number, T: number, r: number, sigma: number, type: 'call' | 'put'): number {
  if (T <= 0) {
    // At or past expiry: intrinsic value
    return type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  }
  if (sigma <= 0) return type === 'call' ? Math.max(S - K * Math.exp(-r * T), 0) : Math.max(K * Math.exp(-r * T) - S, 0);

  const D1 = d1(S, K, T, r, sigma);
  const D2 = d2(S, K, T, r, sigma);

  if (type === 'call') {
    return S * cdf(D1) - K * Math.exp(-r * T) * cdf(D2);
  } else {
    return K * Math.exp(-r * T) * cdf(-D2) - S * cdf(-D1);
  }
}

export function bsDelta(S: number, K: number, T: number, r: number, sigma: number, type: 'call' | 'put'): number {
  if (T <= 0 || sigma <= 0) return type === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
  const D1 = d1(S, K, T, r, sigma);
  return type === 'call' ? cdf(D1) : cdf(D1) - 1;
}

export function bsGamma(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) return 0;
  const D1 = d1(S, K, T, r, sigma);
  return pdf(D1) / (S * sigma * Math.sqrt(T));
}

export function bsTheta(S: number, K: number, T: number, r: number, sigma: number, type: 'call' | 'put'): number {
  if (T <= 0 || sigma <= 0) return 0;
  const D1 = d1(S, K, T, r, sigma);
  const D2 = d2(S, K, T, r, sigma);
  const sqrtT = Math.sqrt(T);

  const term1 = -(S * pdf(D1) * sigma) / (2 * sqrtT);
  if (type === 'call') {
    return (term1 - r * K * Math.exp(-r * T) * cdf(D2)) / 365;
  } else {
    return (term1 + r * K * Math.exp(-r * T) * cdf(-D2)) / 365;
  }
}

export function bsVega(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) return 0;
  const D1 = d1(S, K, T, r, sigma);
  return S * pdf(D1) * Math.sqrt(T) / 100; // per 1% move in vol
}

/**
 * Implied Volatility via Newton-Raphson with bisection fallback.
 * Returns NaN if no solution found.
 */
export function impliedVolatility(
  marketPrice: number,
  S: number,
  K: number,
  T: number,
  r: number,
  type: 'call' | 'put'
): number {
  if (T <= 0 || marketPrice <= 0) return NaN;

  // Intrinsic value check
  const intrinsic = type === 'call' ? Math.max(S - K * Math.exp(-r * T), 0) : Math.max(K * Math.exp(-r * T) - S, 0);
  if (marketPrice < intrinsic * 0.99) return NaN; // below intrinsic

  // Newton-Raphson
  let sigma = 0.3;
  for (let i = 0; i < 100; i++) {
    const price = bsPrice(S, K, T, r, sigma, type);
    const vega100 = bsVega(S, K, T, r, sigma) * 100; // undo the /100
    if (vega100 < 1e-12) break;
    const diff = price - marketPrice;
    if (Math.abs(diff) < 1e-6) return sigma;
    sigma -= diff / vega100;
    if (sigma <= 0.001) sigma = 0.001;
    if (sigma > 5) sigma = 5;
  }

  // Bisection fallback
  let lo = 0.001, hi = 5.0;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const price = bsPrice(S, K, T, r, mid, type);
    if (Math.abs(price - marketPrice) < 1e-6) return mid;
    if (price > marketPrice) hi = mid;
    else lo = mid;
  }

  return (lo + hi) / 2;
}

/**
 * Calculate risk-free rate from put-call parity on ATM options.
 * C - P = S - K * e^(-rT)  =>  r = -ln((S - C + P) / K) / T
 */
export function riskFreeFromParity(
  S: number,
  K: number,
  T: number,
  callPrice: number,
  putPrice: number
): number {
  if (T <= 0) return 0.045; // default
  const ratio = (S - callPrice + putPrice) / K;
  if (ratio <= 0) return 0.045;
  return -Math.log(ratio) / T;
}
