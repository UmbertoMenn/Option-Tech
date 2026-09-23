/**
 * Ingest delle assegnazioni A SCADENZA di put short, indipendente dai file
 * movimenti. Chiamato al caricamento di uno snapshot: confronta le posizioni
 * DB pre-upload con quelle del nuovo snapshot e aggiorna il PMC del titolo
 * assegnato ("carico = strike", nessuna sottrazione del premio).
 *
 * Idempotente: ogni assegnazione applicata viene registrata nel ledger
 * `cost_basis_trades` con chiave naturale univoca (side='ASG',
 * kind='expiry_assignment'). Re-upload dello stesso snapshot non duplica.
 */
import { supabase } from '@/integrations/supabase/client';
import { getCanonicalTickerKey } from '@/lib/tickerIdentity';
import { detectExpiryAssignments, applyExpiryAssignmentToStore, PutPositionLite } from '@/lib/costBasis';
import { fetchDynamicAliases } from '@/lib/costBasisStore';
import { ParsedPosition } from '@/lib/flussiCsvParser';

export interface ExpiryAssignmentIngestResult {
  assignmentsApplied: number;
  warnings: string[];
}

interface OldPositionRow {
  asset_type: string;
  option_type: 'call' | 'put' | null;
  quantity: number | null;
  strike_price: number | null;
  expiry_date: string | null;
  underlying: string | null;
  description: string | null;
  ticker: string | null;
  isin: string | null;
}

export async function ingestExpiryAssignments(
  portfolioId: string,
  snapshotDate: string | null,
  newPositions: ParsedPosition[],
): Promise<ExpiryAssignmentIngestResult> {
  if (!snapshotDate) return { assignmentsApplied: 0, warnings: [] };

  const dynamicAliases = await fetchDynamicAliases();
  const stockUKey = (p: { ticker: string | null; description: string | null }) =>
    getCanonicalTickerKey({ rawTicker: p.ticker, description: p.description }, { dynamicAliases });
  const putUKey = (p: { ticker: string | null; underlying: string | null; description: string }) =>
    getCanonicalTickerKey({ rawTicker: p.ticker, underlyingName: p.underlying, description: p.description }, { dynamicAliases });

  const { data: oldRows, error: oldErr } = await supabase
    .from('positions')
    .select('asset_type, option_type, quantity, strike_price, expiry_date, underlying, description, ticker, isin')
    .eq('portfolio_id', portfolioId);
  if (oldErr) {
    console.error('[ExpiryAssignments] lettura positions pre-upload fallita:', oldErr.message);
    return { assignmentsApplied: 0, warnings: [] };
  }
  const oldPositions = (oldRows || []) as unknown as OldPositionRow[];

  const oldShortPuts: PutPositionLite[] = oldPositions
    .filter(p => p.asset_type === 'derivative' && p.option_type === 'put' && Number(p.quantity) < 0 && p.strike_price && p.expiry_date)
    .map(p => ({
      underlyingKey: putUKey({ ticker: p.ticker, underlying: p.underlying, description: p.description || '' }),
      strike: Number(p.strike_price),
      expiryDate: String(p.expiry_date),
      shortContracts: Math.abs(Number(p.quantity)),
    }));
  if (oldShortPuts.length === 0) return { assignmentsApplied: 0, warnings: [] };

  const oldStockQtyByU = new Map<string, number>();
  for (const p of oldPositions) {
    if (p.asset_type !== 'stock' && p.asset_type !== 'etf') continue;
    const k = stockUKey(p);
    oldStockQtyByU.set(k, (oldStockQtyByU.get(k) || 0) + Number(p.quantity || 0));
  }

  const newShortPutFullKeys = new Set<string>();
  for (const p of newPositions) {
    if (p.asset_type === 'derivative' && p.option_type === 'put' && p.quantity < 0 && p.strike_price && p.expiry_date) {
      const k = putUKey({ ticker: p.ticker, underlying: p.underlying, description: p.description });
      newShortPutFullKeys.add(`${k}|${Number(p.strike_price)}|${String(p.expiry_date)}`);
    }
  }

  const newStockByU = new Map<string, { quantity: number; sample: ParsedPosition }>();
  for (const p of newPositions) {
    if (p.asset_type !== 'stock' && p.asset_type !== 'etf') continue;
    const k = stockUKey(p);
    const prev = newStockByU.get(k);
    newStockByU.set(k, { quantity: (prev?.quantity || 0) + (p.quantity || 0), sample: prev?.sample || p });
  }

  const stockQuantityDeltaByUnderlyingKey = new Map<string, number>();
  const allKeys = new Set<string>([...newStockByU.keys(), ...oldStockQtyByU.keys()]);
  for (const k of allKeys) {
    stockQuantityDeltaByUnderlyingKey.set(k, (newStockByU.get(k)?.quantity || 0) - (oldStockQtyByU.get(k) || 0));
  }

  // Il file Excel porta già il PMC della banca (fiscale o di carico), che
  // include l'assegnazione: per questi titoli niente ricostruzione del PMC né
  // avvisi. Si registra solo l'assegnazione nel ledger (serve alla
  // scomposizione rendimento per i periodi senza file movimenti).
  const pmcFromFileKeys = new Set<string>();
  for (const p of newPositions) {
    if ((p.asset_type === 'stock' || p.asset_type === 'etf') && Number(p.avg_cost) > 0) {
      pmcFromFileKeys.add(stockUKey(p));
    }
  }

  const { assignments, warnings } = detectExpiryAssignments({
    oldShortPuts,
    newShortPutFullKeys,
    snapshotDate,
    stockQuantityDeltaByUnderlyingKey,
    pmcFromFileKeys,
  });

  const outWarnings = [...warnings];
  if (assignments.length === 0) return { assignmentsApplied: 0, warnings: outWarnings };

  const { data: storeRows, error: storeErr } = await supabase
    .from('stock_cost_basis' as never)
    .select('basis_key, pmc, quantity, isin, description, currency')
    .eq('portfolio_id', portfolioId);
  if (storeErr) {
    outWarnings.push(`Lettura PMC store fallita: ${storeErr.message}`);
    return { assignmentsApplied: 0, warnings: outWarnings };
  }
  const storeByKey = new Map<string, { pmc: number; quantity: number; isin: string | null; description: string | null; currency: string | null }>();
  for (const r of (storeRows || []) as unknown as { basis_key: string; pmc: number; quantity: number; isin: string | null; description: string | null; currency: string | null }[]) {
    storeByKey.set(r.basis_key, { pmc: Number(r.pmc), quantity: Number(r.quantity), isin: r.isin, description: r.description, currency: r.currency });
  }

  let applied = 0;
  for (const a of assignments) {
    const stockInNew = newStockByU.get(a.underlyingKey);
    if (!stockInNew) {
      outWarnings.push(`Assegnazione ${a.underlyingKey}: azioni non trovate nel nuovo snapshot, saltata`);
      continue;
    }
    const sample = stockInNew.sample;
    const stockBasisKey = sample.isin
      ? sample.isin.toUpperCase()
      : stockUKey(sample);
    const exchangeRate = Number(sample.exchange_rate || 1) > 0 ? Number(sample.exchange_rate) : 1;
    const underlyingPrice = Number(sample.snapshot_price ?? sample.current_price ?? 0);
    const intrinsicPerShare = underlyingPrice > 0
      ? Math.max(0, a.strike - underlyingPrice)
      : null;

    // Ledger idempotente
    const { data: ledgerInserted, error: ledgerErr } = await supabase
      .from('cost_basis_trades' as never)
      .upsert(
        [{
          portfolio_id: portfolioId,
          basis_key: stockBasisKey,
          trade_date: snapshotDate,
          side: 'ASG',
          quantity: a.shares,
          price: a.strike,
          kind: 'expiry_assignment',
          asset_type: sample.asset_type,
          underlying_key: a.underlyingKey,
          option_type: 'put',
          strike: a.strike,
          currency: sample.currency,
          exchange_rate: exchangeRate,
          gross_eur: a.strike * a.shares / exchangeRate,
          underlying_price: underlyingPrice > 0 ? underlyingPrice : null,
          intrinsic_per_share: intrinsicPerShare,
          time_value_per_share: 0,
          attribution_price_source: underlyingPrice > 0 ? 'snapshot_proxy' : 'missing',
        }] as never[],
        { onConflict: 'portfolio_id,basis_key,trade_date,side,quantity,price', ignoreDuplicates: true },
      )
      .select('basis_key');
    if (ledgerErr) {
      outWarnings.push(`Ledger assegnazione ${a.underlyingKey} fallito: ${ledgerErr.message}`);
      continue;
    }
    // Un re-upload può incontrare il ledger creato prima delle colonne di
    // attribuzione: lo arricchisce senza riapplicare il PMC.
    await supabase
      .from('cost_basis_trades' as never)
      .update({
        asset_type: sample.asset_type,
        underlying_key: a.underlyingKey,
        option_type: 'put',
        strike: a.strike,
        currency: sample.currency,
        exchange_rate: exchangeRate,
        gross_eur: a.strike * a.shares / exchangeRate,
        underlying_price: underlyingPrice > 0 ? underlyingPrice : null,
        intrinsic_per_share: intrinsicPerShare,
        time_value_per_share: 0,
        attribution_price_source: underlyingPrice > 0 ? 'snapshot_proxy' : 'missing',
      } as never)
      .eq('portfolio_id', portfolioId)
      .eq('basis_key', stockBasisKey)
      .eq('trade_date', snapshotDate)
      .eq('side', 'ASG')
      .eq('quantity', a.shares)
      .eq('price', a.strike);
    if (!ledgerInserted || ledgerInserted.length === 0) {
      // già applicata da un upload precedente
      continue;
    }
    // PMC dal file: lo store viene sincronizzato subito dopo dall'Excel.
    if (pmcFromFileKeys.has(a.underlyingKey)) continue;

    const existingStore = storeByKey.get(stockBasisKey);
    const preExistingShares = oldStockQtyByU.get(a.underlyingKey) || 0;

    const applyRes = applyExpiryAssignmentToStore(a.underlyingKey, {
      existing: existingStore ? { pmc: existingStore.pmc, quantity: existingStore.quantity } : null,
      preExistingShares,
      strike: a.strike,
      shares: a.shares,
    });

    const rollbackLedger = async () => {
      await supabase
        .from('cost_basis_trades' as never)
        .delete()
        .eq('portfolio_id', portfolioId)
        .eq('basis_key', stockBasisKey)
        .eq('trade_date', snapshotDate)
        .eq('side', 'ASG')
        .eq('quantity', a.shares)
        .eq('price', a.strike);
    };

    if (!applyRes.next) {
      if (applyRes.warning) outWarnings.push(applyRes.warning);
      await rollbackLedger();
      continue;
    }

    const { error: upsertErr } = await supabase
      .from('stock_cost_basis' as never)
      .upsert(
        [{
          portfolio_id: portfolioId,
          basis_key: stockBasisKey,
          isin: sample.isin ? sample.isin.toUpperCase() : (existingStore?.isin ?? null),
          description: sample.description || existingStore?.description || null,
          pmc: applyRes.next.pmc,
          quantity: applyRes.next.quantity,
          currency: sample.currency || existingStore?.currency || null,
          source: 'expiry_assignment',
          updated_at: new Date().toISOString(),
        }] as never[],
        { onConflict: 'portfolio_id,basis_key' },
      );
    if (upsertErr) {
      outWarnings.push(`Salvataggio PMC assegnazione ${a.underlyingKey} fallito: ${upsertErr.message}`);
      await rollbackLedger();
      continue;
    }
    applied += 1;
    console.log(`[ExpiryAssignments] ${a.underlyingKey}: ${a.shares} azioni @ strike ${a.strike} → PMC ${applyRes.next.pmc.toFixed(2)}`);
  }

  return { assignmentsApplied: applied, warnings: outWarnings };
}
