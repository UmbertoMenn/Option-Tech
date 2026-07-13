/**
 * Ponte tra lo store PMC (stock_cost_basis) e le positions.
 *
 * Le positions vengono cancellate e reinserite ad ogni upload: il PMC vive
 * quindi nello store persistente e viene APPLICATO alle posizioni parsate
 * prima dell'insert. Quando invece l'upload porta con sé il PMC (vecchio file
 * Excel), lo store viene SINCRONIZZATO da quei valori (fonte 'excel'):
 * ricaricare l'Excel riallinea tutto.
 */

import { supabase } from '@/integrations/supabase/client';
import { getCanonicalTickerKey } from '@/lib/tickerIdentity';
import { ParsedPosition } from '@/lib/flussiCsvParser';

const PMC_ASSET_TYPES = new Set(['stock', 'etf']);

export function positionBasisKey(p: Pick<ParsedPosition, 'isin' | 'ticker' | 'description'>): string {
  return p.isin ? p.isin.toUpperCase() : getCanonicalTickerKey({ rawTicker: p.ticker, description: p.description });
}

export interface CostBasisStoreRow {
  basis_key: string;
  isin: string | null;
  description: string | null;
  pmc: number;
  quantity: number;
  currency: string | null;
}

export async function fetchCostBasisStore(portfolioId: string): Promise<Map<string, CostBasisStoreRow>> {
  const { data, error } = await supabase
    .from('stock_cost_basis' as never)
    .select('basis_key, isin, description, pmc, quantity, currency')
    .eq('portfolio_id', portfolioId);
  if (error) {
    console.error('[CostBasis] lettura store fallita:', error.message);
    return new Map();
  }
  const map = new Map<string, CostBasisStoreRow>();
  for (const r of (data || []) as unknown as CostBasisStoreRow[]) {
    map.set(r.basis_key, { ...r, pmc: Number(r.pmc), quantity: Number(r.quantity) });
  }
  return map;
}

/**
 * Applica il PMC dello store alle posizioni parsate (stock/ETF senza
 * avg_cost). Muta e restituisce l'array. Ricalcola anche profit_loss e
 * profit_loss_pct quando il prezzo corrente è disponibile.
 */
export function applyCostBasisToPositions(
  positions: ParsedPosition[],
  store: Map<string, CostBasisStoreRow>,
): { applied: number } {
  let applied = 0;
  for (const p of positions) {
    if (!PMC_ASSET_TYPES.has(p.asset_type)) continue;
    if (p.avg_cost != null) continue; // il file (Excel) ha già il PMC: vince
    const row = store.get(positionBasisKey(p));
    if (!row || !(row.pmc > 0)) continue;
    p.avg_cost = row.pmc;
    if (p.current_price != null && p.quantity) {
      p.profit_loss = (p.current_price - row.pmc) * p.quantity;
      p.profit_loss_pct = row.pmc !== 0 ? ((p.current_price - row.pmc) / row.pmc) * 100 : null;
    }
    applied += 1;
  }
  return { applied };
}

/**
 * Sincronizza lo store dai PMC presenti nelle posizioni parsate (vecchio file
 * Excel): upsert di pmc + quantità con fonte 'excel'. È il meccanismo di
 * primo caricamento e di riallineamento.
 */
export async function syncCostBasisStoreFromPositions(
  portfolioId: string,
  positions: Pick<ParsedPosition, 'isin' | 'ticker' | 'description' | 'asset_type' | 'avg_cost' | 'quantity' | 'currency'>[],
): Promise<{ synced: number }> {
  const rows = positions
    .filter(p => PMC_ASSET_TYPES.has(p.asset_type) && p.avg_cost != null && p.avg_cost > 0)
    .map(p => ({
      portfolio_id: portfolioId,
      basis_key: positionBasisKey(p),
      isin: p.isin ? p.isin.toUpperCase() : null,
      description: p.description || null,
      pmc: p.avg_cost as number,
      quantity: p.quantity || 0,
      currency: p.currency || null,
      source: 'excel',
      updated_at: new Date().toISOString(),
    }));
  if (rows.length === 0) return { synced: 0 };

  // Deduplica per basis_key (l'Excel può avere lo stesso titolo su più conti):
  // somma le quantità e media ponderata dei PMC.
  const byKey = new Map<string, typeof rows[number]>();
  for (const r of rows) {
    const prev = byKey.get(r.basis_key);
    if (!prev) {
      byKey.set(r.basis_key, { ...r });
    } else {
      const totQty = prev.quantity + r.quantity;
      prev.pmc = totQty > 0 ? (prev.pmc * prev.quantity + r.pmc * r.quantity) / totQty : prev.pmc;
      prev.quantity = totQty;
    }
  }

  const { error } = await supabase
    .from('stock_cost_basis' as never)
    .upsert(Array.from(byKey.values()) as never[], { onConflict: 'portfolio_id,basis_key' });
  if (error) throw new Error(`Errore sincronizzazione PMC: ${error.message}`);
  return { synced: byKey.size };
}
