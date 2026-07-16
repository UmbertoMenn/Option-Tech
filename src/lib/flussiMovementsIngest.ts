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
import { FlussiCashMovement, FlussiTitoliOptionTrade, FlussiTitoliStockTrade, buildDepositCandidates, pairInternalTransfers } from '@/lib/flussiCsvParser';
import { extractCallBuybacks, CallResell } from '@/lib/callBuybacks';
import { applyStockTradesToBasis, applyOptionTradesToBasis, detectEarlyAssignments, optionBasisKey, CostBasisEntry, EarlyAssignment, PutPositionLite } from '@/lib/costBasis';
import { getCanonicalTickerKey } from '@/lib/tickerIdentity';
import { fetchDynamicAliases } from '@/lib/costBasisStore';
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
  warnings: string[];
}

/**
 * Applica una rivendita ai riacquisti aperti dello stesso descrittore (FIFO per data).
 *
 * Idempotente: la rivendita viene prima registrata nel ledger
 * `call_resell_ledger` con chiave naturale univoca. Se era già stata applicata
 * da un upload precedente (file sovrapposti o ricaricati) non viene riapplicata.
 * Senza questo controllo una rivendita PARZIALE veniva scalata due volte,
 * riducendo la quantità aperta oltre il dovuto.
 */
async function applyResell(
  portfolioId: string,
  resell: CallResell,
): Promise<{ applied: number; warnings: string[] }> {
  const warnings: string[] = [];

  // Ledger: se la riga esiste già, questa rivendita è stata applicata prima.
  const { data: ledgerInserted, error: ledgerErr } = await supabase
    .from('call_resell_ledger' as never)
    .upsert(
      [{
        portfolio_id: portfolioId,
        descriptor: resell.descriptor,
        resell_date: resell.resell_date,
        quantity: resell.quantity,
        resell_price: resell.resell_price,
      }] as never[],
      { onConflict: 'portfolio_id,descriptor,resell_date,quantity,resell_price', ignoreDuplicates: true },
    )
    .select('id');
  if (ledgerErr) {
    console.error('[flussiIngest] ledger rivendite fallito:', ledgerErr.message);
    return { applied: 0, warnings };
  }
  if (!ledgerInserted || ledgerInserted.length === 0) {
    // Già applicata in un upload precedente.
    return { applied: 0, warnings };
  }
  const ledgerId = (ledgerInserted as unknown as { id: string }[])[0].id;

  const { data: open, error } = await supabase
    .from('call_buybacks' as never)
    .select('id, quantity, resold_quantity, manually_edited')
    .eq('portfolio_id', portfolioId)
    .eq('descriptor', resell.descriptor)
    .gt('quantity', 0)
    .order('buyback_date', { ascending: true });
  if (error) {
    console.error('[flussiIngest] lettura buyback aperti fallita:', error.message);
    return { applied: 0, warnings };
  }

  let remaining = resell.quantity;
  let applied = 0;
  for (const row of (open || []) as unknown as { id: string; quantity: number; resold_quantity: number; manually_edited?: boolean }[]) {
    if (remaining <= 0) break;
    // Riga corretta a mano: è il lotto FIFO di competenza, ma il titolare la
    // gestisce da sé. Ci si ferma qui invece di far scivolare la rivendita sul
    // lotto successivo, che verrebbe scalato al posto di quello giusto.
    if (row.manually_edited) {
      warnings.push(
        `Rivendita di ${remaining} ${resell.descriptor} non applicata: il riacquisto più vecchio è stato modificato a mano. Aggiorna la quantità manualmente.`,
      );
      break;
    }
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

  // Traccia quanto è stato effettivamente scalato: se resta scoperto (nessun
  // riacquisto aperto o riga manuale), il ledger lo registra e la rivendita
  // non viene comunque ritentata al prossimo upload dello stesso file.
  await supabase
    .from('call_resell_ledger' as never)
    .update({ applied_quantity: applied } as never)
    .eq('id', ledgerId);

  return { applied, warnings };
}

export async function ingestTitoliTrades(
  portfolioId: string,
  trades: FlussiTitoliOptionTrade[],
): Promise<TitoliIngestResult> {
  if (trades.length === 0) return { buybacksUpserted: 0, resellsApplied: 0, warnings: [] };

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
    // Le righe già corrette a mano dal titolare (manually_edited = true) sono
    // canoniche: strike/scadenza/quantità/prezzo di riacquisto non vengono più
    // toccati dal CSV. Vengono sovrascritte solo le righe ancora "automatiche".
    // Chiave di conflitto: (portfolio_id, descriptor, buyback_date).
    const { data: existingRows, error: manualErr } = await supabase
      .from('call_buybacks' as never)
      .select('descriptor, buyback_date, resold_quantity, manually_edited')
      .eq('portfolio_id', portfolioId);
    if (manualErr) {
      console.error('[flussiIngest] lettura buyback esistenti fallita:', manualErr.message);
    }
    const existingByKey = new Map<string, { resold_quantity: number; manually_edited: boolean }>();
    for (const r of (existingRows || []) as unknown as { descriptor: string; buyback_date: string; resold_quantity: number | null; manually_edited: boolean }[]) {
      existingByKey.set(`${r.descriptor}|${r.buyback_date}`, {
        resold_quantity: Number(r.resold_quantity || 0),
        manually_edited: !!r.manually_edited,
      });
    }

    const rows = buybacks
      .filter(b => !existingByKey.get(`${b.descriptor}|${b.buyback_date}`)?.manually_edited)
      .map(b => {
        // Il CSV riporta la quantità ORIGINARIA del riacquisto. Se una parte è
        // già stata rivenduta, riscriverla tale e quale resusciterebbe i
        // contratti chiusi ad ogni ricaricamento del file: si scala il
        // rivenduto già registrato.
        const prev = existingByKey.get(`${b.descriptor}|${b.buyback_date}`);
        const resold = prev?.resold_quantity ?? 0;
        return {
          portfolio_id: portfolioId,
          underlying: b.underlying,
          descriptor: b.descriptor,
          strike: b.strike,
          expiry_date: b.expiry_date,
          quantity: Math.max(0, b.quantity - resold),
          buyback_price: b.buyback_price,
          currency: b.currency,
          exchange_rate: b.exchange_rate,
          buyback_date: b.buyback_date,
        };
      });
    if (rows.length > 0) {
      const { error } = await supabase
        .from('call_buybacks' as never)
        .upsert(rows as never[], { onConflict: 'portfolio_id,descriptor,buyback_date' });
      if (error) throw new Error(`Errore salvataggio riacquisti call: ${error.message}`);
      buybacksUpserted = rows.length;
    }
  }

  let resellsApplied = 0;
  const warnings: string[] = [];
  for (const r of resells) {
    const res = await applyResell(portfolioId, r);
    resellsApplied += res.applied;
    warnings.push(...res.warnings);
  }

  return { buybacksUpserted, resellsApplied, warnings };
}

export interface CostBasisIngestResult {
  tradesApplied: number;
  assignmentsDetected: number;
  warnings: string[];
}

/**
 * Aggiorna lo store PMC (stock_cost_basis) dai movimenti titoli.
 *
 * - Idempotente: ogni movimento applicato viene registrato nel ledger
 *   cost_basis_trades con chiave naturale univoca; ricaricare lo stesso file
 *   non riapplica nulla.
 * - Rileva le assegnazioni anticipate di put confrontando le put short
 *   pre-upload (DB) con quelle del saldo aggiornato (file nello stesso
 *   batch): le vendite di azioni che chiudono un lotto assegnato NON toccano
 *   PMC/quantità del titolo preesistente.
 * - newSnapshotPositions: posizioni del saldo aggiornato appena parsate
 *   (stesso batch di upload). Se assente, il rilevamento assegnazioni è
 *   disattivato e tutte le vendite sono trattate come normali.
 */
export async function ingestStockTradesCostBasis(
  portfolioId: string,
  stockTrades: FlussiTitoliStockTrade[],
  optionTrades: FlussiTitoliOptionTrade[],
  newSnapshotPositions?: Pick<Position, 'asset_type' | 'option_type' | 'quantity' | 'strike_price' | 'expiry_date' | 'underlying' | 'description' | 'ticker'>[],
): Promise<CostBasisIngestResult> {
  if (stockTrades.length === 0 && optionTrades.length === 0) {
    return { tradesApplied: 0, assignmentsDetected: 0, warnings: [] };
  }

  // Chiavi di risoluzione: ISIN quando disponibile (deterministico), altrimenti
  // chiave canonica del ticker via resolver, SEMPRE con gli alias dinamici da
  // underlying_mappings (la mappa statica non copre tutti i sottostanti: senza
  // alias si ripiega su NAME:<descrizione> e la chiave non combacia più con
  // quella prodotta dal caricamento Excel).
  const dynamicAliases = await fetchDynamicAliases();
  const stockKey = (t: FlussiTitoliStockTrade): string =>
    t.isin ? t.isin.toUpperCase() : getCanonicalTickerKey({ description: t.description }, { dynamicAliases });
  const optionKey = (underlyingTicker: string): string =>
    getCanonicalTickerKey({ rawTicker: underlyingTicker }, { dynamicAliases });
  const optionTradeKey = (t: FlussiTitoliOptionTrade): string =>
    optionBasisKey(optionKey(t.underlyingTicker), t.optionType, t.strike, t.expiryDate);

  // ---- Ledger di idempotenza: inserisce le chiavi naturali; i conflitti
  // (già applicati in un upload precedente) vengono esclusi. Titoli e
  // opzioni condividono il ledger: la chiave OPT:... non collide con gli ISIN. ----
  const ledgerRows = [
    ...stockTrades.map(t => ({
      portfolio_id: portfolioId,
      basis_key: stockKey(t),
      trade_date: t.tradeDate,
      side: t.side,
      quantity: t.quantity,
      price: t.price,
    })),
    ...optionTrades.map(t => ({
      portfolio_id: portfolioId,
      basis_key: optionTradeKey(t),
      trade_date: t.tradeDate,
      side: t.side,
      quantity: t.contracts,
      price: t.pricePerShare,
    })),
  ];
  const { data: inserted, error: ledgerErr } = await supabase
    .from('cost_basis_trades' as never)
    .upsert(ledgerRows as never[], {
      onConflict: 'portfolio_id,basis_key,trade_date,side,quantity,price',
      ignoreDuplicates: true,
    })
    .select('basis_key, trade_date, side, quantity, price');
  if (ledgerErr) throw new Error(`Errore ledger PMC: ${ledgerErr.message}`);

  const newLedgerKeys = new Set(
    ((inserted || []) as unknown as { basis_key: string; trade_date: string; side: string; quantity: number; price: number }[])
      .map(r => `${r.basis_key}|${r.trade_date}|${r.side}|${r.quantity}|${r.price}`),
  );
  const freshTrades = stockTrades.filter(t =>
    newLedgerKeys.has(`${stockKey(t)}|${t.tradeDate}|${t.side}|${t.quantity}|${t.price}`),
  );
  const freshOptionTrades = optionTrades.filter(t =>
    newLedgerKeys.has(`${optionTradeKey(t)}|${t.tradeDate}|${t.side}|${t.contracts}|${t.pricePerShare}`),
  );
  if (freshTrades.length === 0 && freshOptionTrades.length === 0) {
    return { tradesApplied: 0, assignmentsDetected: 0, warnings: [] };
  }

  // ---- Rilevamento assegnazioni anticipate (richiede il saldo aggiornato) ----
  const toPutLite = (
    rows: Pick<Position, 'asset_type' | 'option_type' | 'quantity' | 'strike_price' | 'expiry_date' | 'underlying' | 'description' | 'ticker'>[],
  ): PutPositionLite[] =>
    rows
      .filter(p => p.asset_type === 'derivative' && p.option_type === 'put' && p.quantity < 0 && p.strike_price && p.expiry_date)
      .map(p => ({
        underlyingKey: getCanonicalTickerKey({ rawTicker: p.ticker, underlyingName: p.underlying, description: p.description }, { dynamicAliases }),
        strike: Number(p.strike_price),
        expiryDate: String(p.expiry_date),
        shortContracts: Math.abs(Number(p.quantity)),
      }));

  let assignments: EarlyAssignment[] = [];
  if (newSnapshotPositions && newSnapshotPositions.length > 0) {
    const { data: oldPositions } = await supabase
      .from('positions')
      .select('asset_type, option_type, quantity, strike_price, expiry_date, underlying, description, ticker')
      .eq('portfolio_id', portfolioId)
      .eq('asset_type', 'derivative');
    assignments = detectEarlyAssignments(
      toPutLite((oldPositions || []) as unknown as Position[]),
      toPutLite(newSnapshotPositions),
      freshTrades,
      optionTrades,
      stockKey,
      optionKey,
    );
    if (assignments.length > 0) {
      console.log('[CostBasis] assegnazioni anticipate rilevate:', assignments.map(a => `${a.underlyingKey} ${a.contracts}×100 @ strike ${a.strike}`));
    }
  }

  // ---- Applica alla media ponderata ----
  const { data: existingRows, error: readErr } = await supabase
    .from('stock_cost_basis' as never)
    .select('*')
    .eq('portfolio_id', portfolioId);
  if (readErr) throw new Error(`Errore lettura PMC: ${readErr.message}`);

  const existing: CostBasisEntry[] = ((existingRows || []) as unknown as {
    basis_key: string; isin: string | null; description: string | null;
    pmc: number; quantity: number; currency: string | null;
  }[]).map(r => ({
    basisKey: r.basis_key,
    isin: r.isin,
    description: r.description,
    pmc: Number(r.pmc),
    quantity: Number(r.quantity),
    currency: r.currency,
  }));

  // Quantità già in portafoglio PRIMA dell'upload: distingue un titolo nuovo
  // (ACQ può creare il PMC) da uno già posseduto senza PMC di partenza (ACQ
  // NON deve inventare una baseline sul solo lotto nuovo).
  const { data: preStockPositions } = await supabase
    .from('positions')
    .select('isin, ticker, description, quantity, asset_type')
    .eq('portfolio_id', portfolioId)
    .in('asset_type', ['stock', 'etf']);
  const preExistingQuantities = new Map<string, number>();
  for (const p of (preStockPositions || []) as unknown as { isin: string | null; ticker: string | null; description: string | null; quantity: number }[]) {
    const k = p.isin ? p.isin.toUpperCase() : getCanonicalTickerKey({ rawTicker: p.ticker, description: p.description }, { dynamicAliases });
    preExistingQuantities.set(k, (preExistingQuantities.get(k) || 0) + Number(p.quantity || 0));
  }

  const result = applyStockTradesToBasis(existing, freshTrades, assignments, stockKey, preExistingQuantities);
  for (const w of result.warnings) console.warn('[CostBasis]', w);

  // I trade saltati per mancanza di PMC di partenza NON sono stati applicati:
  // vanno tolti dal ledger, altrimenti dopo il caricamento del PMC da Excel
  // verrebbero considerati già assorbiti e persi per sempre.
  for (const t of result.skippedNoBaseline) {
    await supabase
      .from('cost_basis_trades' as never)
      .delete()
      .eq('portfolio_id', portfolioId)
      .eq('basis_key', stockKey(t))
      .eq('trade_date', t.tradeDate)
      .eq('side', t.side)
      .eq('quantity', t.quantity)
      .eq('price', t.price);
  }

  // ---- PMC opzioni: posizione firmata, media del premio per direzione ----
  const optionResult = applyOptionTradesToBasis(
    Array.from(result.entries.values()),
    freshOptionTrades,
    optionKey,
  );

  // Marca nel ledger le vendite nettate come chiusure di assegnazione
  for (const t of result.assignmentCloses) {
    await supabase
      .from('cost_basis_trades' as never)
      .update({ kind: 'assignment_close' } as never)
      .eq('portfolio_id', portfolioId)
      .eq('basis_key', stockKey(t))
      .eq('trade_date', t.tradeDate)
      .eq('side', t.side)
      .eq('quantity', t.quantity)
      .eq('price', t.price);
  }

  // Upsert dello store: solo le chiavi toccate dai trade nuovi
  const touchedKeys = new Set([
    ...result.normalTrades.map(stockKey),
    ...result.assignmentCloses.map(stockKey),
    ...freshOptionTrades.map(optionTradeKey),
  ]);
  const upserts = Array.from(optionResult.entries.values())
    .filter(e => touchedKeys.has(e.basisKey))
    .map(e => ({
      portfolio_id: portfolioId,
      basis_key: e.basisKey,
      isin: e.isin,
      description: e.description,
      pmc: e.pmc,
      quantity: e.quantity,
      currency: e.currency,
      source: 'movements',
      updated_at: new Date().toISOString(),
    }));
  if (upserts.length > 0) {
    const { error: upsertErr } = await supabase
      .from('stock_cost_basis' as never)
      .upsert(upserts as never[], { onConflict: 'portfolio_id,basis_key' });
    if (upsertErr) throw new Error(`Errore salvataggio PMC: ${upsertErr.message}`);
  }

  return {
    tradesApplied: result.normalTrades.length + result.assignmentCloses.length + optionResult.applied,
    assignmentsDetected: assignments.length,
    warnings: result.warnings,
  };
}
