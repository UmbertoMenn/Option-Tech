/**
 * Ingest a DB dei due file movimenti dei flussi CSV banca.
 *
 * - Movimenti CASH → versamenti/prelievi automatici nella tabella `deposits`.
 *   Semantica idempotente: upsert per (portfolio_id, deposit_date) con
 *   SOSTITUZIONE dell'importo — ricaricare lo stesso file non raddoppia.
 *   Le righe inserite A MANO (source='manual' o legacy) non vengono MAI
 *   sovrascritte; i giroconti interni tra conti del cliente (cash ↔ GP)
 *   vengono esclusi in coppia. Presupposto: i movimenti di una stessa data
 *   valuta arrivano interi in un unico file (estrazione per periodo).
 *
 * - Movimenti TITOLI → riacquisti call CC/DR-CC nella tabella
 *   `call_buybacks` (idempotente per portfolio/descrittore/data) e
 *   applicazione delle rivendite ai riacquisti aperti (FIFO per data).
 */
import { supabase } from '@/integrations/supabase/client';
import { FlussiCashMovement, FlussiTitoliOptionTrade, buildDepositCandidates, pairInternalTransfers } from '@/lib/flussiCsvParser';
import { extractCallBuybacks, CallResell } from '@/lib/callBuybacks';
import { Position } from '@/types/portfolio';
import { StrategyConfiguration } from '@/hooks/useStrategyConfigurations';

export interface CashIngestResult {
  depositsUpserted: number;
  totalAmount: number;
  /** Date con un versamento/prelievo inserito A MANO: mai sovrascritte dal CSV */
  skippedManualDates: string[];
  /** Coppie di giroconti interni (es. cash ↔ GP) escluse dal registro */
  internalTransfersExcluded: number;
}

export async function ingestCashMovements(
  portfolioId: string,
  movements: FlussiCashMovement[],
): Promise<CashIngestResult> {
  const { internalPairs } = pairInternalTransfers(movements);
  const candidates = buildDepositCandidates(movements);
  if (candidates.length === 0) {
    return { depositsUpserted: 0, totalAmount: 0, skippedManualDates: [], internalTransfersExcluded: internalPairs.length };
  }

  // Le righe inserite a mano dal titolare (source = 'manual', o legacy senza
  // source) sono canoniche: il CSV non le tocca MAI. Vengono sovrascritte
  // solo le righe create da un precedente ingest CSV (source = 'csv_auto'),
  // per mantenere l'idempotenza del ricaricamento dello stesso file.
  const { data: existing, error: readErr } = await supabase
    .from('deposits')
    .select('deposit_date, source' as '*')
    .eq('portfolio_id', portfolioId)
    .in('deposit_date', candidates.map(c => c.deposit_date));
  if (readErr) throw new Error(`Errore lettura versamenti esistenti: ${readErr.message}`);

  const manualDates = new Set(
    ((existing || []) as unknown as { deposit_date: string; source?: string | null }[])
      .filter(r => (r.source ?? 'manual') !== 'csv_auto')
      .map(r => r.deposit_date),
  );

  const toUpsert = candidates.filter(c => !manualDates.has(c.deposit_date));
  const skippedManualDates = candidates.filter(c => manualDates.has(c.deposit_date)).map(c => c.deposit_date);

  if (toUpsert.length > 0) {
    const rows = toUpsert.map(c => ({
      portfolio_id: portfolioId,
      deposit_date: c.deposit_date,
      amount: c.amount,
      description: c.description || 'Da movimenti conto (automatico)',
      source: 'csv_auto',
    }));

    const { error } = await supabase
      .from('deposits')
      .upsert(rows as never[], { onConflict: 'portfolio_id,deposit_date' });
    if (error) throw new Error(`Errore salvataggio versamenti/prelievi: ${error.message}`);
  }

  return {
    depositsUpserted: toUpsert.length,
    totalAmount: toUpsert.reduce((s, c) => s + c.amount, 0),
    skippedManualDates,
    internalTransfersExcluded: internalPairs.length,
  };
}

export interface TitoliIngestResult {
  buybacksUpserted: number;
  resellsApplied: number;
}

/** Applica una rivendita ai riacquisti aperti dello stesso descrittore (FIFO per data). */
async function applyResell(portfolioId: string, resell: CallResell): Promise<number> {
  const { data: open, error } = await supabase
    .from('call_buybacks' as never)
    .select('id, quantity, resold_quantity')
    .eq('portfolio_id', portfolioId)
    .eq('descriptor', resell.descriptor)
    .gt('quantity', 0)
    .order('buyback_date', { ascending: true });
  if (error) {
    console.error('[flussiIngest] lettura buyback aperti fallita:', error.message);
    return 0;
  }

  let remaining = resell.quantity;
  let applied = 0;
  for (const row of (open || []) as unknown as { id: string; quantity: number; resold_quantity: number }[]) {
    if (remaining <= 0) break;
    const take = Math.min(row.quantity, remaining);
    const { error: updErr } = await supabase
      .from('call_buybacks' as never)
      .update({
        quantity: row.quantity - take,
        resold_quantity: (row.resold_quantity || 0) + take,
        resell_price: resell.resell_price,
        resell_date: resell.resell_date,
      } as never)
      .eq('id', row.id);
    if (updErr) {
      console.error('[flussiIngest] applicazione rivendita fallita:', updErr.message);
      break;
    }
    remaining -= take;
    applied += take;
  }
  return applied;
}

export async function ingestTitoliTrades(
  portfolioId: string,
  trades: FlussiTitoliOptionTrade[],
): Promise<TitoliIngestResult> {
  if (trades.length === 0) return { buybacksUpserted: 0, resellsApplied: 0 };

  // Stato corrente (PRE-aggiornamento posizioni): serve a distinguere i
  // riacquisti dalle aperture long. Le call vendute vengono cercate sia
  // nelle posizioni sia nelle firme delle config CC/DR-CC.
  const [{ data: positions }, { data: configs }] = await Promise.all([
    supabase.from('positions').select('*').eq('portfolio_id', portfolioId).eq('asset_type', 'derivative'),
    supabase.from('strategy_configurations').select('*').eq('portfolio_id', portfolioId),
  ]);

  const { buybacks, resells } = extractCallBuybacks(
    trades,
    (positions || []) as unknown as Position[],
    (configs || []) as unknown as StrategyConfiguration[],
  );

  let buybacksUpserted = 0;
  if (buybacks.length > 0) {
    const rows = buybacks.map(b => ({
      portfolio_id: portfolioId,
      underlying: b.underlying,
      descriptor: b.descriptor,
      strike: b.strike,
      expiry_date: b.expiry_date,
      quantity: b.quantity,
      buyback_price: b.buyback_price,
      currency: b.currency,
      exchange_rate: b.exchange_rate,
      buyback_date: b.buyback_date,
    }));
    const { error } = await supabase
      .from('call_buybacks' as never)
      .upsert(rows as never[], { onConflict: 'portfolio_id,descriptor,buyback_date' });
    if (error) throw new Error(`Errore salvataggio riacquisti call: ${error.message}`);
    buybacksUpserted = rows.length;
  }

  let resellsApplied = 0;
  for (const r of resells) {
    resellsApplied += await applyResell(portfolioId, r);
  }

  return { buybacksUpserted, resellsApplied };
}
