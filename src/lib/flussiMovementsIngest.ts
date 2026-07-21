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
import { applyStockTradesToBasis, applyOptionTradesToBasis, detectEarlyAssignments, detectEarlyCallAssignments, optionBasisKey, CostBasisEntry, EarlyAssignment, PutPositionLite, CallPositionLite, CallAssignmentDetected } from '@/lib/costBasis';
import { getCanonicalTickerKey } from '@/lib/tickerIdentity';
import { fetchDynamicAliases } from '@/lib/costBasisStore';
import { Position } from '@/types/portfolio';
import { StrategyConfiguration } from '@/hooks/useStrategyConfigurations';
import { fetchHistoricalUnderlyingPrices, splitOptionPremium } from '@/lib/optionTradeAttribution';

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

  // I giroconti cash ↔ GP non sono apporti esterni, ma sono indispensabili
  // per depurare il rendimento della GP e quello della liquidità dai travasi
  // interni. Il ledger è idempotente e non espone questa informazione come
  // versamento/prelievo nella UI.
  const gpTransfers = internalPairs.flatMap(([debit, credit]) => {
    if (debit.isGP === credit.isGP) return [];
    const amount = Math.abs(debit.amount);
    const transferKey = [
      debit.operationId || '-',
      credit.operationId || '-',
      debit.accountId,
      credit.accountId,
      debit.movementDate,
      credit.movementDate,
      amount.toFixed(2),
      debit.isGP ? 'GP_OUT' : 'GP_IN',
    ].join('|');
    return [{
      portfolio_id: portfolioId,
      transfer_key: transferKey,
      debit_date: debit.movementDate,
      credit_date: credit.movementDate,
      amount_eur: amount,
      from_gp: debit.isGP,
      to_gp: credit.isGP,
    }];
  });
  if (gpTransfers.length > 0) {
    const { error: transferErr } = await supabase
      .from('internal_transfer_ledger' as never)
      .upsert(gpTransfers as never[], { onConflict: 'portfolio_id,transfer_key', ignoreDuplicates: true });
    if (transferErr) console.warn('[flussiIngest] ledger giroconti GP non aggiornato:', transferErr.message);
  }

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
  newSnapshotPositions?: Pick<Position, 'asset_type' | 'option_type' | 'quantity' | 'strike_price' | 'expiry_date' | 'underlying' | 'description' | 'ticker' | 'isin' | 'currency' | 'exchange_rate' | 'snapshot_price' | 'current_price'>[],
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
  const stockUnderlyingKey = (t: FlussiTitoliStockTrade): string => {
    const linked = newSnapshotPositions?.find(position =>
      !!t.isin && position.isin?.toUpperCase() === t.isin.toUpperCase(),
    );
    return getCanonicalTickerKey({
      rawTicker: linked?.ticker,
      underlyingName: linked?.underlying,
      description: linked?.description || t.description,
    }, { dynamicAliases });
  };
  const optionKey = (underlyingTicker: string): string =>
    getCanonicalTickerKey({ rawTicker: underlyingTicker }, { dynamicAliases });
  const optionTradeKey = (t: FlussiTitoliOptionTrade): string =>
    optionBasisKey(optionKey(t.underlyingTicker), t.optionType, t.strike, t.expiryDate);

  const historicalPrices = await fetchHistoricalUnderlyingPrices(optionTrades, optionKey);
  const attributionWarnings: string[] = [];
  const optionMetadata = new Map<FlussiTitoliOptionTrade, Record<string, unknown>>();
  for (const trade of optionTrades) {
    const underlyingKey = optionKey(trade.underlyingTicker);
    const historical = historicalPrices.get(`${underlyingKey}|${trade.tradeDate}`);
    const underlyingPrice = Number(historical?.close_price || 0);
    const split = underlyingPrice > 0
      ? splitOptionPremium(trade.optionType, trade.strike, trade.pricePerShare, underlyingPrice)
      : null;
    if (!split) {
      attributionWarnings.push(
        `${underlyingKey} ${trade.tradeDate}: prezzo storico del sottostante non disponibile; premio temporale non attribuito`,
      );
    } else if (split.intrinsicCappedToPremium) {
      attributionWarnings.push(
        `${underlyingKey} ${trade.tradeDate}: premio inferiore all'intrinseco teorico; intrinseco limitato al premio osservato`,
      );
    }
    optionMetadata.set(trade, {
      asset_type: 'derivative',
      underlying_key: underlyingKey,
      option_type: trade.optionType,
      strike: trade.strike,
      expiry_date: trade.expiryDate,
      currency: trade.currency,
      exchange_rate: trade.exchangeRate || 1,
      gross_eur: Math.abs(trade.grossEUR || (trade.pricePerShare * trade.contracts * 100) / (trade.exchangeRate || 1)),
      commission_eur: Math.abs(trade.commission || 0),
      underlying_price: underlyingPrice > 0 ? underlyingPrice : null,
      intrinsic_per_share: split?.intrinsicPerShare ?? null,
      time_value_per_share: split?.timeValuePerShare ?? null,
      attribution_price_source: historical?.source ?? 'missing',
    });
  }

  const stockMetadata = new Map<FlussiTitoliStockTrade, Record<string, unknown>>();
  for (const trade of stockTrades) {
    const matchingPosition = newSnapshotPositions?.find(position =>
      !!trade.isin && position.isin?.toUpperCase() === trade.isin.toUpperCase(),
    );
    stockMetadata.set(trade, {
      // Se il titolo non è nello snapshot finale (es. vendita totale), non
      // indoviniamo "stock": il motore lo risolve dagli snapshot di inizio/fine.
      asset_type: matchingPosition?.asset_type ?? null,
      currency: trade.currency || matchingPosition?.currency || null,
      exchange_rate: trade.exchangeRate || matchingPosition?.exchange_rate || 1,
      gross_eur: Math.abs(trade.grossEUR || (trade.price * trade.quantity) / (trade.exchangeRate || 1)),
      commission_eur: Math.abs(trade.commission || 0),
    });
  }

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
      ...stockMetadata.get(t),
    })),
    ...optionTrades.map(t => ({
      portfolio_id: portfolioId,
      basis_key: optionTradeKey(t),
      trade_date: t.tradeDate,
      side: t.side,
      quantity: t.contracts,
      price: t.pricePerShare,
      ...optionMetadata.get(t),
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

  // Un re-upload può incontrare righe ledger create prima dell'introduzione
  // dell'attribuzione. Le arricchiamo comunque, senza riapplicare il PMC.
  for (const trade of [...stockTrades, ...optionTrades]) {
    const isOption = 'contracts' in trade;
    const basisKey = isOption
      ? optionTradeKey(trade as FlussiTitoliOptionTrade)
      : stockKey(trade as FlussiTitoliStockTrade);
    const quantity = isOption
      ? (trade as FlussiTitoliOptionTrade).contracts
      : (trade as FlussiTitoliStockTrade).quantity;
    const price = isOption
      ? (trade as FlussiTitoliOptionTrade).pricePerShare
      : (trade as FlussiTitoliStockTrade).price;
    const metadata = isOption
      ? optionMetadata.get(trade as FlussiTitoliOptionTrade)
      : stockMetadata.get(trade as FlussiTitoliStockTrade);
    if (!metadata) continue;
    const { error: enrichErr } = await supabase
      .from('cost_basis_trades' as never)
      .update(metadata as never)
      .eq('portfolio_id', portfolioId)
      .eq('basis_key', basisKey)
      .eq('trade_date', trade.tradeDate)
      .eq('side', trade.side)
      .eq('quantity', quantity)
      .eq('price', price);
    if (enrichErr) console.warn('[CostBasis] arricchimento attribuzione fallito:', enrichErr.message);
  }

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
    return { tradesApplied: 0, assignmentsDetected: 0, warnings: attributionWarnings };
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

  const toCallLite = (
    rows: Pick<Position, 'asset_type' | 'option_type' | 'quantity' | 'strike_price' | 'expiry_date' | 'underlying' | 'description' | 'ticker'>[],
  ): CallPositionLite[] =>
    rows
      .filter(p => p.asset_type === 'derivative' && p.option_type === 'call' && p.quantity < 0 && p.strike_price && p.expiry_date)
      .map(p => ({
        underlyingKey: getCanonicalTickerKey({ rawTicker: p.ticker, underlyingName: p.underlying, description: p.description }, { dynamicAliases }),
        strike: Number(p.strike_price),
        expiryDate: String(p.expiry_date),
        shortContracts: Math.abs(Number(p.quantity)),
      }));

  // Metadati del titolo pre-upload per sottostante: servono a valorizzare la
  // riga ASG delle call assegnate (il titolo può essere già sparito dal nuovo
  // snapshot perché richiamato).
  interface OldStockMeta { isin: string | null; currency: string | null; exchangeRate: number; spot: number }
  const oldStockMetaByU = new Map<string, OldStockMeta>();

  let assignments: EarlyAssignment[] = [];
  let callAssignments: CallAssignmentDetected[] = [];
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
      stockUnderlyingKey,
      optionKey,
    );
    if (assignments.length > 0) {
      console.log('[CostBasis] assegnazioni anticipate rilevate:', assignments.map(a => `${a.underlyingKey} ${a.contracts}×100 @ strike ${a.strike}`));
    }

    // ---- Assegnazioni CALL (covered call richiamata) ----
    // Segnale: call short sparita dal saldo + azioni diminuite di contracts×100
    // SENZA una VEN che lo spieghi (le azioni escono "assegnate", non vendute).
    const { data: oldStockRows } = await supabase
      .from('positions')
      .select('ticker, description, isin, quantity, currency, exchange_rate, current_price, asset_type')
      .eq('portfolio_id', portfolioId)
      .in('asset_type', ['stock', 'etf']);
    const oldStockByU = new Map<string, number>();
    for (const p of (oldStockRows || []) as unknown as { ticker: string | null; description: string | null; isin: string | null; quantity: number; currency: string | null; exchange_rate: number | null; current_price: number | null }[]) {
      const u = getCanonicalTickerKey({ rawTicker: p.ticker, description: p.description }, { dynamicAliases });
      oldStockByU.set(u, (oldStockByU.get(u) || 0) + Number(p.quantity || 0));
      if (!oldStockMetaByU.has(u)) {
        oldStockMetaByU.set(u, {
          isin: p.isin,
          currency: p.currency,
          exchangeRate: Number(p.exchange_rate || 1) > 0 ? Number(p.exchange_rate) : 1,
          spot: Number(p.current_price || 0),
        });
      }
    }
    const newStockByU = new Map<string, number>();
    for (const p of newSnapshotPositions) {
      if (p.asset_type !== 'stock' && p.asset_type !== 'etf') continue;
      const u = getCanonicalTickerKey({ rawTicker: p.ticker, underlyingName: p.underlying, description: p.description }, { dynamicAliases });
      newStockByU.set(u, (newStockByU.get(u) || 0) + Number(p.quantity || 0));
    }
    const venSharesByU = new Map<string, number>();
    for (const t of freshTrades) {
      if (t.side !== 'VEN') continue;
      const u = stockUnderlyingKey(t);
      venSharesByU.set(u, (venSharesByU.get(u) || 0) + t.quantity);
    }
    const unexplainedShareDropByUnderlyingKey = new Map<string, number>();
    for (const u of new Set<string>([...oldStockByU.keys(), ...newStockByU.keys()])) {
      const drop = (oldStockByU.get(u) || 0) - (newStockByU.get(u) || 0) - (venSharesByU.get(u) || 0);
      unexplainedShareDropByUnderlyingKey.set(u, drop);
    }
    const newShortCallFullKeys = new Set(
      toCallLite(newSnapshotPositions).map(c => `${c.underlyingKey}|${c.strike}|${c.expiryDate}`),
    );
    const callBuybackFullKeys = new Set(
      optionTrades
        .filter(t => t.optionType === 'call' && t.side === 'ACQ')
        .map(t => `${optionKey(t.underlyingTicker)}|${t.strike}|${t.expiryDate}`),
    );
    const callResult = detectEarlyCallAssignments({
      oldShortCalls: toCallLite((oldPositions || []) as unknown as Position[]),
      newShortCallFullKeys,
      callBuybackFullKeys,
      unexplainedShareDropByUnderlyingKey,
    });
    callAssignments = callResult.assignments;
    for (const warning of callResult.warnings) attributionWarnings.push(warning);
    if (callAssignments.length > 0) {
      console.log('[CostBasis] assegnazioni call rilevate:', callAssignments.map(a => `${a.underlyingKey} ${a.contracts}×100 @ strike ${a.strike}`));
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

  // Il PMC è indicizzato per ISIN, mentre il detector lavora per sottostante.
  // Traduce la sola chiave delle assegnazioni prima di consumare le vendite.
  const assignmentsForBasis = assignments.map(assignment => {
    const matchingTrade = freshTrades.find(trade =>
      stockUnderlyingKey(trade) === assignment.underlyingKey,
    );
    return matchingTrade
      ? { ...assignment, underlyingKey: stockKey(matchingTrade) }
      : assignment;
  });
  const result = applyStockTradesToBasis(existing, freshTrades, assignmentsForBasis, stockKey, preExistingQuantities);
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

  // Registra anche l'assegnazione anticipata come trasferimento informativo.
  // Non tocca il PMC (già gestito sopra), ma consente all'attribuzione di
  // neutralizzare strike pagato, azioni ricevute e intrinseco estinto.
  for (const assignment of assignments) {
    const closeTrade = result.assignmentCloses.find(trade =>
      stockUnderlyingKey(trade) === assignment.underlyingKey,
    );
    if (!closeTrade) continue;
    const exchangeRate = closeTrade.exchangeRate > 0 ? closeTrade.exchangeRate : 1;
    const historical = historicalPrices.get(`${assignment.underlyingKey}|${closeTrade.tradeDate}`);
    const underlyingPrice = Number(historical?.close_price || 0);
    const assignedPosition = newSnapshotPositions?.find(position =>
      position.asset_type !== 'derivative'
      && getCanonicalTickerKey({
        rawTicker: position.ticker,
        underlyingName: position.underlying,
        description: position.description,
      }, { dynamicAliases }) === assignment.underlyingKey,
    );
    const fallbackSpot = Number(assignedPosition?.snapshot_price ?? assignedPosition?.current_price ?? 0);
    const spot = underlyingPrice > 0 ? underlyingPrice : fallbackSpot;
    const intrinsic = spot > 0 ? Math.max(0, assignment.strike - spot) : null;
    const { error: assignmentLedgerError } = await supabase
      .from('cost_basis_trades' as never)
      .upsert([{
        portfolio_id: portfolioId,
        basis_key: stockKey(closeTrade),
        trade_date: closeTrade.tradeDate,
        side: 'ASG',
        quantity: assignment.shares,
        price: assignment.strike,
        kind: 'early_assignment',
        asset_type: assignedPosition?.asset_type ?? 'stock',
        underlying_key: assignment.underlyingKey,
        option_type: 'put',
        strike: assignment.strike,
        currency: closeTrade.currency,
        exchange_rate: exchangeRate,
        gross_eur: assignment.strike * assignment.shares / exchangeRate,
        underlying_price: spot > 0 ? spot : null,
        intrinsic_per_share: intrinsic,
        time_value_per_share: 0,
        attribution_price_source: historical?.source ?? (spot > 0 ? 'snapshot_proxy' : 'missing'),
      }] as never[], {
        onConflict: 'portfolio_id,basis_key,trade_date,side,quantity,price',
        ignoreDuplicates: true,
      });
    if (assignmentLedgerError) {
      attributionWarnings.push(`Ledger assegnazione ${assignment.underlyingKey} non aggiornato: ${assignmentLedgerError.message}`);
    }
  }

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

  // ---- Assegnazioni CALL: riga ASG per l'attribuzione + scarico quantità dal
  // PMC (come una VEN, PMC invariato). Idempotente: lo scarico avviene solo se
  // la riga ASG è NUOVA (un re-upload non la riapplica).
  const callAssignmentTouchedKeys: string[] = [];
  if (callAssignments.length > 0) {
    const batchDate = [...stockTrades, ...optionTrades]
      .reduce<string>((max, t) => (t.tradeDate > max ? t.tradeDate : max), '0000-00-00');
    for (const assignment of callAssignments) {
      const meta = oldStockMetaByU.get(assignment.underlyingKey);
      const basisKey = meta?.isin ? meta.isin.toUpperCase() : assignment.underlyingKey;
      const exchangeRate = meta && meta.exchangeRate > 0 ? meta.exchangeRate : 1;
      const spot = meta && meta.spot > 0 ? meta.spot : 0;
      const intrinsic = spot > 0 ? Math.max(0, spot - assignment.strike) : null;
      const { data: insertedAsg, error: asgError } = await supabase
        .from('cost_basis_trades' as never)
        .upsert([{
          portfolio_id: portfolioId,
          basis_key: basisKey,
          trade_date: batchDate,
          side: 'ASG',
          quantity: assignment.shares,
          price: assignment.strike,
          kind: 'call_assignment',
          asset_type: 'stock',
          underlying_key: assignment.underlyingKey,
          option_type: 'call',
          strike: assignment.strike,
          currency: meta?.currency ?? null,
          exchange_rate: exchangeRate,
          gross_eur: assignment.strike * assignment.shares / exchangeRate,
          underlying_price: spot > 0 ? spot : null,
          intrinsic_per_share: intrinsic,
          time_value_per_share: 0,
          attribution_price_source: spot > 0 ? 'snapshot_proxy' : 'missing',
        }] as never[], {
          onConflict: 'portfolio_id,basis_key,trade_date,side,quantity,price',
          ignoreDuplicates: true,
        })
        .select('basis_key');
      if (asgError) {
        attributionWarnings.push(`Ledger assegnazione call ${assignment.underlyingKey} non aggiornato: ${asgError.message}`);
        continue;
      }
      // Solo se la riga è nuova: scarico la quantità una sola volta.
      if (!Array.isArray(insertedAsg) || insertedAsg.length === 0) continue;
      const entry = optionResult.entries.get(basisKey);
      if (!entry || entry.quantity <= 0) {
        attributionWarnings.push(`Assegnazione call ${assignment.underlyingKey}: nessun PMC tracciato per ${basisKey} — quantità non scaricata (caricare prima il PMC dal file Excel)`);
        continue;
      }
      if (assignment.shares > entry.quantity) {
        attributionWarnings.push(`Assegnazione call ${assignment.underlyingKey}: azioni richiamate (${assignment.shares}) superiori alla quantità tracciata (${entry.quantity}): quantità azzerata`);
        entry.quantity = 0;
      } else {
        entry.quantity -= assignment.shares; // PMC invariato, come una VEN normale
      }
      callAssignmentTouchedKeys.push(basisKey);
    }
  }

  // Upsert dello store: solo le chiavi toccate dai trade nuovi
  const touchedKeys = new Set([
    ...result.normalTrades.map(stockKey),
    ...result.assignmentCloses.map(stockKey),
    ...freshOptionTrades.map(optionTradeKey),
    ...callAssignmentTouchedKeys,
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
    assignmentsDetected: assignments.length + callAssignments.length,
    warnings: [...result.warnings, ...attributionWarnings],
  };
}
