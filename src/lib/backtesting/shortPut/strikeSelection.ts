/**
 * Selezione strike — funzioni pure sul singolo snapshot di catena.
 * Convenzioni:
 * - premiumPct di una gamba = premio per azione / strike × 100
 *   (equivale a premio contratto / nozionale contratto, indipendente dai contratti).
 * - netPremiumPct di un roll = (incasso nuova put − costo chiusura vecchia) / nuovo strike × 100.
 * - Fill: vendita a sellFill(quote), chiusura a buyFill(quote), secondo il modello configurato.
 */
import { PutQuote, ShortPutConfig, ShortPutFillModel } from './types';

export interface FillEngine {
  sellFill(quote: PutQuote): number;
  buyFill(quote: PutQuote): number;
}

export function createFillEngine(execution: ShortPutConfig['execution']): FillEngine {
  const mid = (q: PutQuote) => (q.bid + q.ask) / 2;
  const half = (q: PutQuote) => (q.ask - q.bid) / 2;
  const model: ShortPutFillModel = execution.fillModel;
  const slip = Math.min(Math.max(execution.slippagePctOfHalfSpread, 0), 100) / 100;
  return {
    sellFill(q) {
      if (model === 'natural') return q.bid;
      if (model === 'mid') return mid(q);
      return mid(q) - half(q) * slip;
    },
    buyFill(q) {
      if (model === 'natural') return q.ask;
      if (model === 'mid') return mid(q);
      return mid(q) + half(q) * slip;
    },
  };
}

export function premiumPct(sellPrice: number, strike: number): number {
  return (sellPrice / strike) * 100;
}

export function netPremiumPct(newSellPrice: number, oldBuyPrice: number, newStrike: number): number {
  return ((newSellPrice - oldBuyPrice) / newStrike) * 100;
}

function isTradeable(q: PutQuote): boolean {
  return q.bid > 0 && q.ask > 0 && q.ask >= q.bid;
}

/**
 * Ingresso: put OTM sulla scadenza indicata.
 * - distance: strike più alto ≤ spot × (1 − distancePct/100).
 * - premium: premio in target ± tolleranza; a parità, il più vicino al target,
 *   tie-break sullo strike più basso (più difensivo).
 * - both: vincolo di distanza + premio in tolleranza.
 * Ritorna null se nessun candidato valido (ingresso rimandato).
 */
export function selectEntryStrike(
  chain: PutQuote[],
  expiration: string,
  spot: number,
  entry: ShortPutConfig['entry'],
  fills: FillEngine,
): PutQuote | null {
  const maxStrike = spot * (1 - entry.distancePct / 100);
  const candidates = chain.filter((q) => q.expiration === expiration && q.strike < spot && isTradeable(q));

  if (entry.strikeMode === 'distance') {
    const eligible = candidates.filter((q) => q.strike <= maxStrike);
    if (eligible.length === 0) return null;
    return eligible.reduce((best, q) => (q.strike > best.strike ? q : best));
  }

  const withPremium = candidates
    .filter((q) => (entry.strikeMode === 'premium' ? true : q.strike <= maxStrike))
    .map((q) => ({ q, pct: premiumPct(fills.sellFill(q), q.strike) }))
    .filter(({ pct }) => Math.abs(pct - entry.premiumTargetPct) <= entry.premiumTolerancePct);

  if (withPremium.length === 0) return null;
  withPremium.sort((a, b) => {
    const da = Math.abs(a.pct - entry.premiumTargetPct);
    const db = Math.abs(b.pct - entry.premiumTargetPct);
    if (da !== db) return da - db;
    return a.q.strike - b.q.strike;
  });
  return withPremium[0].q;
}

/**
 * Roll in discesa: scadenze mensili successive a quella corrente (ordine dato,
 * dalla più vicina), strike più basso del corrente, premio netto in
 * target ± tolleranza sul nuovo nozionale. Sulla prima scadenza che offre
 * candidati validi si sceglie lo strike più basso (più difensivo).
 */
export function selectDownsideRoll(
  chain: PutQuote[],
  orderedExpirations: string[],
  currentQuote: PutQuote,
  rule: { netPremiumTargetPct: number; netPremiumTolerancePct: number },
  fills: FillEngine,
): PutQuote | null {
  const closeCost = fills.buyFill(currentQuote);
  for (const expiration of orderedExpirations) {
    const eligible = chain
      .filter((q) => q.expiration === expiration && q.strike < currentQuote.strike && isTradeable(q))
      .map((q) => ({ q, pct: netPremiumPct(fills.sellFill(q), closeCost, q.strike) }))
      .filter(({ pct }) => Math.abs(pct - rule.netPremiumTargetPct) <= rule.netPremiumTolerancePct);
    if (eligible.length > 0) {
      eligible.sort((a, b) => a.q.strike - b.q.strike);
      return eligible[0].q;
    }
  }
  return null;
}

/**
 * Roll al rialzo su prima scadenza: strike più alto possibile con
 * strike > strike corrente, distanza ≥ minDistancePct dallo spot e
 * premio netto ≥ minNetPremiumPct sul nuovo nozionale.
 */
export function selectUpsideRollFront(
  chain: PutQuote[],
  expiration: string,
  spot: number,
  currentQuote: PutQuote,
  upside: ShortPutConfig['upside'],
  fills: FillEngine,
): PutQuote | null {
  const closeCost = fills.buyFill(currentQuote);
  const maxStrike = spot * (1 - upside.minDistancePct / 100);
  const eligible = chain
    .filter((q) => q.expiration === expiration && q.strike > currentQuote.strike && q.strike <= maxStrike && isTradeable(q))
    .map((q) => ({ q, pct: netPremiumPct(fills.sellFill(q), closeCost, q.strike) }))
    .filter(({ pct }) => pct >= upside.minNetPremiumPct);
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => b.q.strike - a.q.strike);
  return eligible[0].q;
}

/**
 * Rientro sulla prima scadenza da una scadenza successiva: strike con
 * distanza ≥ minDistancePct dallo spot e premio netto in
 * recoveryTarget ± tolleranza; si sceglie il più vicino al target,
 * tie-break sullo strike più alto.
 */
export function selectRollToFront(
  chain: PutQuote[],
  frontExpiration: string,
  spot: number,
  currentQuote: PutQuote,
  upside: ShortPutConfig['upside'],
  fills: FillEngine,
): PutQuote | null {
  const closeCost = fills.buyFill(currentQuote);
  const maxStrike = spot * (1 - upside.minDistancePct / 100);
  const eligible = chain
    .filter((q) => q.expiration === frontExpiration && q.strike <= maxStrike && isTradeable(q))
    .map((q) => ({ q, pct: netPremiumPct(fills.sellFill(q), closeCost, q.strike) }))
    .filter(({ pct }) => Math.abs(pct - upside.recoveryNetPremiumTargetPct) <= upside.recoveryNetPremiumTolerancePct);
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    const da = Math.abs(a.pct - upside.recoveryNetPremiumTargetPct);
    const db = Math.abs(b.pct - upside.recoveryNetPremiumTargetPct);
    if (da !== db) return da - db;
    return b.q.strike - a.q.strike;
  });
  return eligible[0].q;
}
