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

/** Costo unitario d'acquisto comprensivo di commissioni, nella divisa del titolo. */
export function unitCostWithCommission(t: FlussiTitoliStockTrade): number {
  // La commissione è in EUR; exchangeRate = divisa per 1 EUR (es. 1.14 USD/EUR).
  const commissionCcy = (t.commission || 0) * (t.exchangeRate > 0 ? t.exchangeRate : 1);
  return t.price + (t.quantity > 0 ? commissionCcy / t.quantity : 0);
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
 */
export function applyStockTradesToBasis(
  existing: CostBasisEntry[],
  stockTrades: FlussiTitoliStockTrade[],
  assignments: EarlyAssignment[],
  resolveStockKey: (t: FlussiTitoliStockTrade) => string,
): AppliedTradeResult {
  const entries = new Map<string, CostBasisEntry>(
    existing.map(e => [e.basisKey, { ...e }]),
  );
  const warnings: string[] = [];
  const assignmentCloses: FlussiTitoliStockTrade[] = [];
  const normalTrades: FlussiTitoliStockTrade[] = [];

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

  return { entries, assignmentCloses, normalTrades, warnings };
}
