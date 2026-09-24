/**
 * P/L di dettaglio per le gambe mostrate nelle righe espanse della pagina Derivati.
 *
 * - Titolo detenuto (CC / DR-CC): P/L rispetto al PMC (= prezzo medio fiscale).
 * - Opzione venduta: scomposizione al prezzo spot del sottostante in
 *     perdita intrinseca  = −valore intrinseco
 *     P/L temporale       = premio incassato (PMC) − valore temporale residuo
 *     P/L totale          = PMC − prezzo opzione  (= intrinseca + temporale)
 *   Il valore temporale residuo è (prezzo − intrinseco) senza clamp, così la somma
 *   delle due componenti coincide sempre con il totale.
 */

export const OPTION_MULTIPLIER = 100;

export interface StockPnlVsPmc {
  perShare: number;
  total: number;
  pct: number;
}

export function stockPnlVsPmc(quantity: number, avgCost: number | null | undefined, price: number | null | undefined): StockPnlVsPmc | null {
  const pmc = Number(avgCost) || 0;
  const px = Number(price) || 0;
  const qty = Number(quantity) || 0;
  if (pmc <= 0 || px <= 0 || qty === 0) return null;
  const perShare = px - pmc;
  return { perShare, total: perShare * qty, pct: (perShare / pmc) * 100 };
}

export interface SoldOptionPnl {
  contracts: number;
  intrinsicPerShare: number;
  timeValuePerShare: number;
  intrinsicPnl: number;
  timePnl: number;
  totalPnl: number;
}

export function intrinsicValue(optionType: 'call' | 'put', strike: number, spot: number): number {
  return optionType === 'call' ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
}

export function soldOptionPnl(params: {
  optionType: 'call' | 'put' | null | undefined;
  strike: number | null | undefined;
  quantity: number;
  avgCost: number | null | undefined;
  price: number | null | undefined;
  spot: number | null | undefined;
  multiplier?: number;
}): SoldOptionPnl | null {
  const { optionType, quantity } = params;
  const strike = Number(params.strike) || 0;
  const spot = Number(params.spot) || 0;
  const pmc = Number(params.avgCost) || 0;
  const px = Number(params.price) || 0;
  const mult = params.multiplier ?? OPTION_MULTIPLIER;
  if (quantity >= 0 || (optionType !== 'call' && optionType !== 'put')) return null;
  if (strike <= 0 || spot <= 0) return null;
  const contracts = Math.abs(quantity);
  const k = contracts * mult;
  const intrinsicPerShare = intrinsicValue(optionType, strike, spot);
  const timeValuePerShare = px - intrinsicPerShare;
  return {
    contracts,
    intrinsicPerShare,
    timeValuePerShare,
    intrinsicPnl: -intrinsicPerShare * k,
    timePnl: (pmc - timeValuePerShare) * k,
    totalPnl: (pmc - px) * k,
  };
}
