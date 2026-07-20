/**
 * Logica pura del prezzo medio di carico (PMC) dei titoli.
 *
 * Regole (confermate con il titolare):
 * - Media ponderata continua (regola fiscale italiana): gli ACQUISTI
 *   ricalcolano il PMC = (qtà×PMC + qtà_acq×costo_unitario)/(qtà totale);
 *   le VENDITE (anche parziali) riducono la quantità ma NON cambiano il PMC.
 *   Il costo unitario d'acquisto include le commissioni (convertite nella
 *   divisa del titolo), coerente con il PMC bancario.
 * - Assegnazione anticipata di una PUT venduta: la banca non mostra
 *   l'acquisto dei titoli assegnati. Il pattern osservabile è: vendita di
 *   azioni (100 o multiplo) + vendita di una NUOVA put sullo stesso
 *   sottostante nei movimenti, mentre la vecchia put è sparita dal saldo
 *   aggiornato (senza riacquisto e prima della scadenza). In quel caso la
 *   vendita di azioni chiude il lotto assegnato (carico = strike) e viene
 *   nettata a parte: quantità e PMC del titolo preesistente restano INVARIATI.
 *
 * Funzioni pure, testabili senza Supabase. L'I/O sta in flussiMovementsIngest.
 */

import { FlussiTitoliStockTrade, FlussiTitoliOptionTrade } from '@/lib/flussiCsvParser';

export interface CostBasisEntry {
  basisKey: string;
  isin: string | null;
  description: string | null;
  pmc: number;
  quantity: number;
  currency: string | null;
}

export interface AppliedTradeResult {
  entries: Map<string, CostBasisEntry>;
  /** Trade applicati come 'assignment_close' (vendita che chiude un lotto assegnato) */
  assignmentCloses: FlussiTitoliStockTrade[];
  /** Trade normali applicati (acquisti/vendite che toccano il PMC/quantità) */
  normalTrades: FlussiTitoliStockTrade[];
  /**
   * Trade NON applicati perché manca il PMC di partenza del titolo. Non vanno
   * marcati come applicati nel ledger: dopo il caricamento del PMC da Excel
   * devono poter essere riapplicati.
   */
  skippedNoBaseline: FlussiTitoliStockTrade[];
  warnings: string[];
}

/** Posizione "minima" usata per il rilevamento assegnazioni (vecchie e nuove). */
export interface PutPositionLite {
  underlyingKey: string;
  strike: number;
  expiryDate: string; // ISO
  /** Contratti short (positivo, es. 2 = -2 in posizione) */
  shortContracts: number;
}

export interface EarlyAssignment {
  underlyingKey: string;
  strike: number;
  expiryDate: string;
  contracts: number;
  /** Azioni coperte dal lotto assegnato (contracts × 100) */
  shares: number;
}

/**
 * Rileva le assegnazioni anticipate confrontando le put short pre-upload con
 * quelle del saldo aggiornato, in presenza del pattern nei movimenti.
 *
 * Condizioni per il sottostante U (chiave canonica):
 * 1. una put short su U presente prima NON è più nel saldo aggiornato,
 *    con scadenza ≥ minima data operazione (quindi non scaduta naturalmente);
 * 2. nessun riacquisto della put nei movimenti (ACQ put stessa strike/scadenza);
 * 3. nei movimenti c'è la vendita di azioni di U per almeno contracts×100;
 * 4. nei movimenti c'è la vendita (VEN) di una NUOVA put su U.
 */
export function detectEarlyAssignments(
  oldShortPuts: PutPositionLite[],
  newShortPuts: PutPositionLite[],
  stockTrades: FlussiTitoliStockTrade[],
  optionTrades: FlussiTitoliOptionTrade[],
  resolveStockKey: (t: FlussiTitoliStockTrade) => string,
  resolveOptionKey: (underlyingTicker: string) => string,
): EarlyAssignment[] {
  const assignments: EarlyAssignment[] = [];
  if (oldShortPuts.length === 0 || stockTrades.length === 0) return assignments;

  const minTradeDate = stockTrades.reduce(
    (min, t) => (t.tradeDate < min ? t.tradeDate : min),
    stockTrades[0].tradeDate,
  );

  const newKeys = new Set(
    newShortPuts.map(p => `${p.underlyingKey}|${p.strike}|${p.expiryDate}`),
  );

  // Vendite azioni per sottostante (solo multipli di 100)
  const sharesSoldByKey = new Map<string, number>();
  for (const t of stockTrades) {
    if (t.side !== 'VEN') continue;
    if (t.quantity % 100 !== 0) continue;
    const k = resolveStockKey(t);
    sharesSoldByKey.set(k, (sharesSoldByKey.get(k) || 0) + t.quantity);
  }

  // Nuove put vendute per sottostante
  const newPutSoldKeys = new Set(
    optionTrades
      .filter(t => t.optionType === 'put' && t.side === 'VEN')
      .map(t => resolveOptionKey(t.underlyingTicker)),
  );

  // Riacquisti put (ACQ) per chiave completa: escludono l'assegnazione
  const putBuybackKeys = new Set(
    optionTrades
      .filter(t => t.optionType === 'put' && t.side === 'ACQ')
      .map(t => `${resolveOptionKey(t.underlyingTicker)}|${t.strike}|${t.expiryDate}`),
  );

  for (const oldPut of oldShortPuts) {
    const fullKey = `${oldPut.underlyingKey}|${oldPut.strike}|${oldPut.expiryDate}`;
    if (newKeys.has(fullKey)) continue;              // ancora presente
    if (oldPut.expiryDate < minTradeDate) continue;   // scaduta naturalmente
    if (putBuybackKeys.has(fullKey)) continue;        // ricomprata, non assegnata
    if (!newPutSoldKeys.has(oldPut.underlyingKey)) continue; // manca la nuova put

    const sharesSold = sharesSoldByKey.get(oldPut.underlyingKey) || 0;
    const sharesNeeded = oldPut.shortContracts * 100;
    if (sharesSold < sharesNeeded) continue;          // vendita azioni insufficiente

    assignments.push({
      underlyingKey: oldPut.underlyingKey,
      strike: oldPut.strike,
      expiryDate: oldPut.expiryDate,
      contracts: oldPut.shortContracts,
      shares: sharesNeeded,
    });
    // Consuma le azioni per non riusarle su un'altra put dello stesso sottostante
    sharesSoldByKey.set(oldPut.underlyingKey, sharesSold - sharesNeeded);
  }

  return assignments;
}

/**
 * Rileva le assegnazioni A SCADENZA di put short confrontando il DB pre-upload
 * con il nuovo snapshot, SENZA dipendere dai file movimenti.
 *
 * Una put short si considera assegnata se:
 *   1. non è più presente nello snapshot aggiornato;
 *   2. la sua expiry_date è <= snapshotDate (quindi realmente scaduta);
 *   3. nel nuovo snapshot le azioni del sottostante sono aumentate di
 *      almeno contracts×100 rispetto al pre-upload.
 *
 * Ambiguità: se più put sullo stesso sottostante sono sparite con strike
 * diversi, il PMC "a strike" non è univoco per lotto — si produce un warning
 * e si salta il sottostante. Se hanno lo stesso strike, l'assegnazione è
 * considerata unica al medesimo strike.
 *
 * Funzione pura: il chiamante (ingest) risolve chiavi, quantità pre-upload
 * e successivamente applica il PMC allo store.
 */
export interface ExpiryAssignmentInput {
  oldShortPuts: PutPositionLite[];
  /** Chiavi complete `${underlyingKey}|${strike}|${expiryDate}` presenti nel nuovo snapshot. */
  newShortPutFullKeys: Set<string>;
  /** Data snapshot (ISO YYYY-MM-DD). */
  snapshotDate: string;
  /** Δ azioni (nuovo − vecchio) per underlyingKey. Solo positivi contano. */
  stockQuantityDeltaByUnderlyingKey: Map<string, number>;
}

export interface ExpiryAssignmentDetected {
  underlyingKey: string;
  strike: number;
  expiryDate: string;
  contracts: number;
  shares: number;
}

export interface ExpiryAssignmentDetectionResult {
  assignments: ExpiryAssignmentDetected[];
  warnings: string[];
}

export function detectExpiryAssignments(
  input: ExpiryAssignmentInput,
): ExpiryAssignmentDetectionResult {
  const { oldShortPuts, newShortPutFullKeys, snapshotDate, stockQuantityDeltaByUnderlyingKey } = input;
  const assignments: ExpiryAssignmentDetected[] = [];
  const warnings: string[] = [];

  const byU = new Map<string, PutPositionLite[]>();
  for (const p of oldShortPuts) {
    const fullKey = `${p.underlyingKey}|${p.strike}|${p.expiryDate}`;
    if (newShortPutFullKeys.has(fullKey)) continue;   // ancora presente
    if (p.expiryDate > snapshotDate) continue;         // non ancora scaduta
    const arr = byU.get(p.underlyingKey) || [];
    arr.push(p);
    byU.set(p.underlyingKey, arr);
  }

  for (const [uKey, puts] of byU) {
    const expectedShares = puts.reduce((s, p) => s + p.shortContracts * 100, 0);
    const deltaShares = stockQuantityDeltaByUnderlyingKey.get(uKey) || 0;

    if (deltaShares <= 0) continue;                     // put scaduta OTM: nessuna azione
    if (deltaShares !== expectedShares) {
      // Δ positivo ma non coerente: possibile acquisto indipendente nello
      // stesso upload o assegnazione parziale. Non decidiamo arbitrariamente.
      warnings.push(
        `Assegnazione a scadenza non coerente per ${uKey}: attese ${expectedShares} azioni, trovate ${deltaShares} — PMC non aggiornato automaticamente`,
      );
      continue;
    }

    const uniqueStrikes = new Set(puts.map(p => p.strike));
    if (uniqueStrikes.size > 1) {
      warnings.push(
        `Assegnazione a scadenza ambigua per ${uKey}: put a strike diversi (${[...uniqueStrikes].sort((a, b) => a - b).join(', ')}) — PMC non aggiornato automaticamente`,
      );
      continue;
    }
    const strike = puts[0].strike;
    const expiryDate = puts.reduce((max, p) => (p.expiryDate > max ? p.expiryDate : max), puts[0].expiryDate);
    const contracts = puts.reduce((s, p) => s + p.shortContracts, 0);
    assignments.push({
      underlyingKey: uKey,
      strike,
      expiryDate,
      contracts,
      shares: contracts * 100,
    });
  }

  return { assignments, warnings };
}

/**
 * Applicazione pura della regola PMC per una assegnazione a scadenza.
 * Estratta dall'ingest per essere testabile senza Supabase.
 *
 * Ritorna il nuovo stato PMC del titolo, oppure `null` con warning se
 * non è possibile calcolarlo (azioni preesistenti senza PMC noto).
 */
export interface ApplyExpiryAssignmentInput {
  /** Stato PMC store attuale per la basis_key del titolo, o null se assente. */
  existing: { pmc: number; quantity: number } | null;
  /** Azioni del titolo presenti PRIMA dell'upload (dal DB positions pre-upload). */
  preExistingShares: number;
  /** Assegnazione rilevata. */
  strike: number;
  shares: number;
}

export interface ApplyExpiryAssignmentResult {
  next: { pmc: number; quantity: number } | null;
  warning?: string;
}

export function applyExpiryAssignmentToStore(
  underlyingKey: string,
  input: ApplyExpiryAssignmentInput,
): ApplyExpiryAssignmentResult {
  const { existing, preExistingShares, strike, shares } = input;
  if (existing && existing.quantity > 0 && existing.pmc > 0) {
    const newQty = existing.quantity + shares;
    const newPmc = (existing.quantity * existing.pmc + shares * strike) / newQty;
    return { next: { pmc: newPmc, quantity: newQty } };
  }
  if (preExistingShares > 0) {
    return {
      next: null,
      warning: `Assegnazione ${underlyingKey}: erano già presenti ${preExistingShares} azioni senza PMC — PMC non calcolato (caricare prima il PMC dal file Excel)`,
    };
  }
  return { next: { pmc: strike, quantity: shares } };
}

/** Costo unitario d'acquisto comprensivo di commissioni, nella divisa del titolo. */
export function unitCostWithCommission(t: FlussiTitoliStockTrade): number {
  // La commissione è in EUR; exchangeRate = divisa per 1 EUR (es. 1.14 USD/EUR).
  const commissionCcy = (t.commission || 0) * (t.exchangeRate > 0 ? t.exchangeRate : 1);
  return t.price + (t.quantity > 0 ? commissionCcy / t.quantity : 0);
}

/** Chiave dello store PMC per un contratto d'opzione. */
export function optionBasisKey(
  underlyingKey: string,
  optionType: 'call' | 'put',
  strike: number,
  expiryDateISO: string,
): string {
  return `OPT:${underlyingKey}:${optionType === 'call' ? 'C' : 'P'}:${strike}:${expiryDateISO}`;
}

/**
 * Premio unitario per azione, nella divisa del titolo.
 *
 * A differenza dei titoli, il PMC delle opzioni NON include le commissioni:
 * è la convenzione della banca (i PMC opzione nei file sono premi grezzi, a
 * tick di 0,05) ed è quella con cui arriva la baseline dal caricamento Excel.
 * Tenere la stessa convenzione anche sui movimenti è necessario perché la
 * media ponderata non mescoli premi netti e premi lordi.
 *
 * Nota: la vecchia versione sommava la commissione su entrambi i versi, quindi
 * sulle VEN (apertura di una short) gonfiava il premio incassato invece di
 * ridurlo — il premio va sempre a sfavore, mai a favore.
 */
export function optionUnitPremium(t: FlussiTitoliOptionTrade): number {
  return t.pricePerShare;
}

export interface AppliedOptionTradeResult {
  entries: Map<string, CostBasisEntry>;
  applied: number;
}

/**
 * PMC delle opzioni a posizione FIRMATA (quantity in contratti: >0 long,
 * <0 short). Premio grezzo, commissioni escluse (vedi optionUnitPremium).
 * Regole simmetriche alla media ponderata continua:
 * - aprire/aumentare la posizione nella sua direzione (ACQ per le long,
 *   VEN per le short) ricalcola la media del premio per azione;
 * - ridurre la posizione verso zero NON cambia il PMC;
 * - l'attraversamento dello zero apre una nuova posizione al premio del trade.
 */
export function applyOptionTradesToBasis(
  existing: CostBasisEntry[],
  trades: FlussiTitoliOptionTrade[],
  resolveUnderlyingKey: (underlyingTicker: string) => string,
): AppliedOptionTradeResult {
  const entries = new Map<string, CostBasisEntry>(existing.map(e => [e.basisKey, { ...e }]));
  let applied = 0;

  const sorted = [...trades].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

  for (const t of sorted) {
    if (!t.contracts || !Number.isFinite(t.pricePerShare)) continue;
    const key = optionBasisKey(resolveUnderlyingKey(t.underlyingTicker), t.optionType, t.strike, t.expiryDate);
    const unit = optionUnitPremium(t);
    const delta = t.side === 'ACQ' ? t.contracts : -t.contracts;
    const entry = entries.get(key);
    const qty0 = entry?.quantity ?? 0;
    const newQty = qty0 + delta;

    if (!entry || qty0 === 0 || Math.sign(qty0) === Math.sign(delta)) {
      // Apertura o aumento nella stessa direzione: media ponderata dei premi
      const pmc0 = entry && qty0 !== 0 ? entry.pmc : 0;
      const pmc = (Math.abs(qty0) * pmc0 + Math.abs(delta) * unit) / (Math.abs(qty0) + Math.abs(delta));
      entries.set(key, {
        basisKey: key,
        isin: null,
        description: entry?.description || t.descriptor,
        pmc,
        quantity: newQty,
        currency: t.currency || entry?.currency || null,
      });
    } else if (Math.sign(newQty) !== Math.sign(qty0) && newQty !== 0) {
      // Attraversamento dello zero: nuova posizione al premio del trade
      entry.pmc = unit;
      entry.quantity = newQty;
    } else {
      // Riduzione (anche a zero): PMC invariato
      entry.quantity = newQty;
    }
    applied += 1;
  }

  return { entries, applied };
}

/**
 * Applica i movimenti titoli allo store PMC (media ponderata continua).
 *
 * - ACQ: PMC = (qtà×PMC + qtà_acq×costo_unitario)/(qtà+qtà_acq); qtà += acq.
 *   Titolo nuovo: PMC = costo_unitario, qtà = acq.
 * - VEN normale: qtà -= venduta (PMC invariato). Se supera la quantità
 *   tracciata, clamp a 0 con warning.
 * - VEN che chiude un lotto assegnato (assignment_close): nessun effetto su
 *   PMC/quantità del titolo (il lotto invisibile a carico=strike si netta con
 *   la vendita). Le azioni assegnate consumano le vendite in ordine di data.
 *
 * `preExistingQuantities` (chiave → quantità già in portafoglio PRIMA
 * dell'upload) serve a distinguere un titolo davvero nuovo da un titolo già
 * posseduto ma senza PMC di partenza. Nel secondo caso un ACQ NON può creare
 * il PMC: la media risulterebbe calcolata sul solo lotto nuovo, ignorando
 * quello preesistente, con un PMC plausibile ma sbagliato. Meglio nessun PMC
 * che un PMC errato: si emette un warning e si rimanda al caricamento Excel.
 * Se la mappa non viene passata, il comportamento resta quello precedente.
 */
export function applyStockTradesToBasis(
  existing: CostBasisEntry[],
  stockTrades: FlussiTitoliStockTrade[],
  assignments: EarlyAssignment[],
  resolveStockKey: (t: FlussiTitoliStockTrade) => string,
  preExistingQuantities?: Map<string, number>,
): AppliedTradeResult {
  const entries = new Map<string, CostBasisEntry>(
    existing.map(e => [e.basisKey, { ...e }]),
  );
  const warnings: string[] = [];
  const assignmentCloses: FlussiTitoliStockTrade[] = [];
  const normalTrades: FlussiTitoliStockTrade[] = [];
  const skippedNoBaseline: FlussiTitoliStockTrade[] = [];

  // Azioni "assegnate" ancora da consumare per sottostante
  const assignedSharesLeft = new Map<string, number>();
  for (const a of assignments) {
    assignedSharesLeft.set(a.underlyingKey, (assignedSharesLeft.get(a.underlyingKey) || 0) + a.shares);
  }

  const sorted = [...stockTrades].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

  for (const t of sorted) {
    const key = resolveStockKey(t);
    const entry = entries.get(key);

    if (t.side === 'ACQ') {
      const unitCost = unitCostWithCommission(t);
      if (!entry || entry.quantity <= 0) {
        // Titolo già in portafoglio ma assente dallo store: manca il PMC di
        // partenza. Creare qui la baseline dal solo lotto nuovo darebbe un PMC
        // sbagliato senza che si veda. Si salta e si avvisa.
        const held = preExistingQuantities?.get(key) ?? 0;
        if (held > 0) {
          warnings.push(
            `Acquisto di ${t.quantity} ${t.description || t.isin} su una posizione già esistente (${held}) senza PMC di partenza: PMC non calcolato (caricare prima il PMC dal file Excel)`,
          );
          skippedNoBaseline.push(t);
          continue;
        }
        entries.set(key, {
          basisKey: key,
          isin: t.isin || entry?.isin || null,
          description: t.description || entry?.description || null,
          pmc: unitCost,
          quantity: t.quantity,
          currency: t.currency || entry?.currency || null,
        });
      } else {
        const newQty = entry.quantity + t.quantity;
        entry.pmc = (entry.quantity * entry.pmc + t.quantity * unitCost) / newQty;
        entry.quantity = newQty;
        if (!entry.isin && t.isin) entry.isin = t.isin;
      }
      normalTrades.push(t);
      continue;
    }

    // VEN — prima verifica se (in tutto o in parte) chiude un lotto assegnato
    const assignedLeft = assignedSharesLeft.get(key) || 0;
    if (assignedLeft > 0 && t.quantity % 100 === 0 && t.quantity <= assignedLeft) {
      assignedSharesLeft.set(key, assignedLeft - t.quantity);
      assignmentCloses.push(t);
      continue; // nettata a parte: PMC e quantità del preesistente INVARIATI
    }

    if (!entry || entry.quantity <= 0) {
      warnings.push(`Vendita di ${t.quantity} ${t.description || t.isin} senza PMC tracciato: ignorata (caricare prima il PMC dal file Excel)`);
      skippedNoBaseline.push(t);
      continue;
    }
    if (t.quantity > entry.quantity) {
      warnings.push(`Vendita di ${t.quantity} ${t.description || t.isin} superiore alla quantità tracciata (${entry.quantity}): quantità azzerata`);
      entry.quantity = 0;
    } else {
      entry.quantity -= t.quantity;
    }
    normalTrades.push(t);
  }

  return { entries, assignmentCloses, normalTrades, skippedNoBaseline, warnings };
}
