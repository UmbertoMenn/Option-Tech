/**
 * Correzione delle configurazioni strategie di uno snapshot STORICO.
 *
 * In Visualizzazione Storica le config sono quelle congelate in
 * portfolio_full_snapshots.strategy_configurations per quella data. Se erano sbagliate
 * (es. naked put AVGO P360 set-26 configurata per 1 contratto con 2 in portafoglio),
 * l'utente le corregge dal wizard: la modifica riscrive SOLO lo snapshot di quella data,
 * mai le config attuali né altre date.
 *
 * Ogni config di uno snapshot corretto porta il marcatore `historical_edited_at` (ISO):
 *  - mostra "configurazioni corrette il gg/mm" nel banner storico;
 *  - impedisce che un ricongelamento della data (re-upload / ricalcolo) sovrascriva la
 *    correzione con le config live.
 * Nessuna colonna nuova: il marcatore vive nel JSONB delle config congelate.
 */
import type { StrategyConfiguration, UpsertConfigParams } from '@/hooks/useStrategyConfigurations';

export const HISTORICAL_EDIT_FIELD = 'historical_edited_at' as const;

export type HistoricalConfig = StrategyConfiguration & { [HISTORICAL_EDIT_FIELD]?: string | null };

/** Data dell'ultima correzione delle config di uno snapshot storico, o null. */
export function historicalConfigsEditedAt(configs: readonly HistoricalConfig[] | null | undefined): string | null {
  let max: string | null = null;
  for (const c of configs ?? []) {
    const t = c?.[HISTORICAL_EDIT_FIELD];
    if (typeof t === 'string' && t && (max == null || t > max)) max = t;
  }
  return max;
}

const mark = (configs: HistoricalConfig[], nowIso: string): HistoricalConfig[] =>
  configs.map((c) => ({ ...c, [HISTORICAL_EDIT_FIELD]: nowIso }));

function toConfig(
  p: UpsertConfigParams,
  index: number,
  portfolioId: string,
  nowIso: string,
  newId: () => string,
): HistoricalConfig {
  return {
    id: newId(),
    portfolio_id: portfolioId,
    underlying: p.underlying,
    strategy_type: p.strategy_type,
    position_signatures: p.position_signatures ?? [],
    is_synthetic: p.is_synthetic || false,
    linked_stock_id: p.linked_stock_id || null,
    linked_stock_slot_ids: p.linked_stock_slot_ids || [],
    sort_order: p.sort_order ?? index,
    config_locked: p.config_locked ?? false,
    override_canceled_at: p.override_canceled_at ?? null,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

/** Sostituzione completa (wizard "Riconfigura strategie"), stessa semantica di upsertBatch live. */
export function replaceHistoricalConfigs(
  params: UpsertConfigParams[],
  portfolioId: string,
  nowIso: string,
  newId: () => string,
): HistoricalConfig[] {
  return mark(
    params.map((p, i) => toConfig(p, i, portfolioId, nowIso, newId)),
    nowIso,
  );
}

/** Aggiunta di una config (upsertConfig live = insert). */
export function addHistoricalConfig(
  current: HistoricalConfig[],
  param: UpsertConfigParams,
  portfolioId: string,
  nowIso: string,
  newId: () => string,
): HistoricalConfig[] {
  return mark([...current, toConfig(param, current.length, portfolioId, nowIso, newId)], nowIso);
}

/** Rimozione di una config per id. */
export function removeHistoricalConfig(current: HistoricalConfig[], id: string, nowIso: string): HistoricalConfig[] {
  return mark(
    current.filter((c) => c.id !== id),
    nowIso,
  );
}

/** Annullamento override (sblocca la config), come cancelOverride live. */
export function cancelHistoricalOverride(current: HistoricalConfig[], id: string, nowIso: string): HistoricalConfig[] {
  return mark(
    current.map((c) => (c.id === id ? { ...c, config_locked: false, override_canceled_at: nowIso, updated_at: nowIso } : c)),
    nowIso,
  );
}

/**
 * Ricongelamento di una data (saveFullSnapshot): se le config congelate erano state
 * corrette a mano, restano quelle; altrimenti si prendono le config live.
 */
export function configsToFreeze<T>(existing: readonly HistoricalConfig[] | null | undefined, live: T[]): T[] | HistoricalConfig[] {
  return historicalConfigsEditedAt(existing) ? [...(existing as HistoricalConfig[])] : live;
}
