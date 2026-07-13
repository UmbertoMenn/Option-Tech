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
import { optionBasisKey } from '@/lib/costBasis';
import { ParsedPosition } from '@/lib/flussiCsvParser';

const PMC_ASSET_TYPES = new Set(['stock', 'etf']);

export function positionBasisKey(p: Pick<ParsedPosition, 'isin' | 'ticker' | 'description'>): string {
  return p.isin ? p.isin.toUpperCase() : getCanonicalTickerKey({ rawTicker: p.ticker, description: p.description });
}

/** Chiave OPT per una posizione derivata (null se mancano i campi opzione). */
export function derivativeBasisKey(
  p: Pick<ParsedPosition, 'underlying' | 'ticker' | 'description' | 'option_type' | 'strike_price' | 'expiry_date'>,
): string | null {
  if (!p.option_type || p.strike_price == null || !p.expiry_date) return null;
  const uKey = getCanonicalTickerKey({ rawTicker: p.underlying || p.ticker, description: p.description });
  return optionBasisKey(uKey, p.option_type, Number(p.strike_price), String(p.expiry_date));
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
    if (p.avg_cost != null) continue; // il file (Excel) ha già il PMC: vince

    if (PMC_ASSET_TYPES.has(p.asset_type)) {
      const row = store.get(positionBasisKey(p));
      if (!row || !(row.pmc > 0)) continue;
      p.avg_cost = row.pmc;
      if (p.current_price != null && p.quantity) {
        p.profit_loss = (p.current_price - row.pmc) * p.quantity;
        p.profit_loss_pct = row.pmc !== 0 ? ((p.current_price - row.pmc) / row.pmc) * 100 : null;
      }
      applied += 1;
      continue;
    }

    if (p.asset_type === 'derivative') {
      const key = derivativeBasisKey(p);
      if (!key) continue;
      const row = store.get(key);
      if (!row || !(row.pmc > 0)) continue;
      p.avg_cost = row.pmc;
      // Quantità firmata (short negative): (prezzo − premio medio) × qtà × 100
      // dà il segno giusto sia per le long che per le short.
      if (p.current_price != null && p.quantity) {
        p.profit_loss = (p.current_price - row.pmc) * p.quantity * 100;
        p.profit_loss_pct = row.pmc !== 0
          ? (p.profit_loss / (Math.abs(p.quantity) * 100 * row.pmc)) * 100
          : null;
      }
      applied += 1;
    }
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
  positions: Pick<ParsedPosition, 'isin' | 'ticker' | 'description' | 'asset_type' | 'avg_cost' | 'quantity' | 'currency' | 'underlying' | 'option_type' | 'strike_price' | 'expiry_date'>[],
): Promise<{ synced: number }> {
  const rows: {
    portfolio_id: string; basis_key: string; isin: string | null; description: string | null;
    pmc: number; quantity: number; currency: string | null; source: string; updated_at: string;
  }[] = [];
  for (const p of positions) {
    if (p.avg_cost == null || !(p.avg_cost > 0)) continue;
    let key: string | null = null;
    if (PMC_ASSET_TYPES.has(p.asset_type)) {
      key = positionBasisKey(p);
    } else if (p.asset_type === 'derivative') {
      key = derivativeBasisKey(p);
    }
    if (!key) continue;
    rows.push({
      portfolio_id: portfolioId,
      basis_key: key,
      isin: p.isin ? p.isin.toUpperCase() : null,
      description: p.description || null,
      pmc: p.avg_cost,
      quantity: p.quantity || 0,
      currency: p.currency || null,
      source: 'excel',
      updated_at: new Date().toISOString(),
    });
  }
  if (rows.length === 0) return { synced: 0 };

  // Deduplica per basis_key (lo stesso titolo può essere su più conti):
  // somma le quantità (firmate) e media dei PMC pesata sui valori assoluti.
  const byKey = new Map<string, typeof rows[number]>();
  for (const r of rows) {
    const prev = byKey.get(r.basis_key);
    if (!prev) {
      byKey.set(r.basis_key, { ...r });
    } else {
      const w0 = Math.abs(prev.quantity);
      const w1 = Math.abs(r.quantity);
      prev.pmc = (w0 + w1) > 0 ? (prev.pmc * w0 + r.pmc * w1) / (w0 + w1) : prev.pmc;
      prev.quantity = prev.quantity + r.quantity;
    }
  }

  const { error } = await supabase
    .from('stock_cost_basis' as never)
    .upsert(Array.from(byKey.values()) as never[], { onConflict: 'portfolio_id,basis_key' });
  if (error) throw new Error(`Errore sincronizzazione PMC: ${error.message}`);
  return { synced: byKey.size };
}
