/**
 * Prezzi dei sottostanti CONGELATI alla data dello snapshot (historical_data.snapshot_underlying_prices).
 *
 * Unica regola condivisa da Dashboard, Risk Analyzer e Stress Lab:
 *  - vista LIVE (snapshot corrente): prezzo congelato della data; per i sottostanti non ancora
 *    congelati (snapshot non ancora ricalcolato) fallback al prezzo live.
 *  - vista STORICA: SOLO prezzi congelati di quella data. Il prezzo live di oggi non è mai un
 *    sostituto valido di uno spot passato: mischiarlo coi premi dello snapshot produce spot,
 *    intrinseci e IV incongruenti. Un sottostante senza prezzo congelato resta senza spot.
 */
import type { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';

export function mergeFrozenUnderlyingPrices(
  livePrices: Record<string, UnderlyingPrice>,
  frozenRaw: Record<string, unknown> | null | undefined,
  allowLiveFallback: boolean,
): Record<string, UnderlyingPrice> {
  const merged: Record<string, UnderlyingPrice> = {};
  if (allowLiveFallback) {
    for (const [k, v] of Object.entries(livePrices)) merged[k] = v;
  }
  for (const [k, raw] of Object.entries(frozenRaw ?? {})) {
    const px = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(px) && px > 0) merged[k] = { price: px, currency: 'USD' };
  }
  return merged;
}

/** Fonte dello spot usato dallo Stress Lab per un sottostante. */
export type SpotSource = 'titolo' | 'congelato' | 'live';

/**
 * Spot del sottostante di un'opzione NON detenuto come titolo.
 * Priorità: prezzo congelato alla data snapshot → (solo vista live) prezzo live → nessuno.
 */
export function resolveOptionSpot(
  lookupName: string | null | undefined,
  frozenRaw: Record<string, unknown> | null | undefined,
  livePrices: Record<string, UnderlyingPrice>,
  allowLiveFallback: boolean,
): { S: number; src: SpotSource } | null {
  if (!lookupName) return null;
  const raw = frozenRaw?.[lookupName];
  const fz = typeof raw === 'number' ? raw : Number(raw);
  if (raw != null && Number.isFinite(fz) && fz > 0) return { S: fz, src: 'congelato' };
  if (!allowLiveFallback) return null;
  const live = livePrices[lookupName]?.price;
  return typeof live === 'number' && live > 0 ? { S: live, src: 'live' } : null;
}
