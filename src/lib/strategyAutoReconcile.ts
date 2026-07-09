/**
 * Riconciliazione AUTOMATICA delle configurazioni strategia dopo un upload.
 * Il dialog manuale resta solo come paracadute per errori di salvataggio.
 *
 * DECISION TABLE DEFINITIVA (concordata con l'utente, luglio 2026):
 *
 *  1. ROLL — gamba "missing" sostituita dalla gamba "new" più vicina con
 *     stesso underlying/tipo/segno (appaiamento monotono per strike e
 *     scadenza, per bucket). I roll con AUMENTO di quantità tengono i
 *     contratti extra nella STESSA strategia. Copre anche ristrutturazioni
 *     complete (IC richiuso su 4 strike nuovi = 4 roll).
 *
 *  2. RIDUZIONE/CHIUSURA — gamba senza rimpiazzo rimossa; config senza
 *     firme e senza azioni collegate eliminata. Le config con linked_stock
 *     sopravvivono anche senza gambe (stock-only covered call).
 *
 *  3. GAMBE NUOVE (non-roll) — pipeline per sottostante:
 *     a. Tutti e 4 i ruoli (put V+C, call V+C) → UN'unica iron_condor
 *        (stessa scadenza) o double_diagonal.
 *     b. COPPIE contestuali venduta+comprata dello stesso tipo → config
 *        spread 1:1 per quantità (put_spread/call_spread, varianti
 *        diagonal se scadenze diverse). Residui alle regole per-gamba
 *        (es. 2V+1C → spread 1+1, la V residua diventa naked put).
 *     c. Put VENDUTA residua → SEMPRE nuova config naked_put separata
 *        (mai accodata a naked put/spread esistenti; le put vendute
 *        residue dello stesso run confluiscono in una sola nuova config).
 *     d. Put COMPRATA residua → covered_call esistente → append + la
 *        config diventa de-risking; de-risking esistente → check
 *        copertura: se la protezione attuale è PARZIALE rispetto
 *        all'esposizione (azioni/100 + long call + short put ITM, ITM
 *        assunto se prezzo sconosciuto) → append, se COMPLETA → nuova
 *        config 'protection'; naked_put esistente → append (il retype la
 *        trasforma in spread); spread esistente → append; nessuna → nuova
 *        config 'protection'.
 *     e. Call VENDUTA residua → covered_call/de-risking esistente →
 *        append; azione in portafoglio → nuova covered_call linkata;
 *        altrimenti nuova config 'other' separata.
 *     f. Call COMPRATA residua → SEMPRE nuova config leap_call separata
 *        (mai accodata a leap esistenti).
 *
 *  4. RETYPE SEMPRE — ogni config toccata viene riclassificata in base
 *     alla struttura risultante delle gambe (es. IC che degrada a una put
 *     venduta → naked_put; naked put + put comprata → put_spread).
 *     Con azioni collegate: call venduta (+put comprata) → covered_call /
 *     derisking_covered_call; sola put comprata → derisking; senza gambe
 *     → tipo invariato (stock-only).
 *
 *  5. Più config dello stesso tipo POSSONO coesistere sullo stesso
 *     sottostante.
 */
import { StrategyConfiguration, PositionSignature, UpsertConfigParams } from '@/hooks/useStrategyConfigurations';
import { ReconciliationItem } from '@/lib/strategyReconciliation';
import { getCanonicalTickerKey } from '@/lib/tickerIdentity';
import { Position } from '@/types/portfolio';

export interface AutoReconcileResult {
  /** Set completo di config da salvare (full replace). null = nessuna modifica automatica */
  resolvedConfigs: UpsertConfigParams[] | null;
  /** Log leggibile (italiano) delle modifiche applicate, per toast/console */
  changes: string[];
  /** Item non risolvibili automaticamente (in pratica: mai, salvo item senza gambe) */
  unresolvedItems: ReconciliationItem[];
  hasAutoChanges: boolean;
}

export interface AutoReconcileContext {
  /** Tutte le posizioni del portafoglio (per matching azioni e coperture) */
  allPositions?: Position[];
  /** Prezzi correnti dei sottostanti, per il check ITM delle short put */
  underlyingPrices?: Record<string, { price?: number | null }>;
}

/**
 * Chiave di raggruppamento sottostante — vedi nota gemella in
 * strategyReconciliation.ts. Instradata sul resolver canonico condiviso
 * con le mappe dinamiche da `underlying_mappings` (backend), così le
 * corrispondenze nome-esteso→ticker già presenti a DB non vanno duplicate
 * in liste statiche.
 */
function normalizeUnderlying(
  text: string,
  linkedStock?: Position | null,
  dynamicAliases?: Map<string, string> | Record<string, string>,
): string {
  return getCanonicalTickerKey(
    { rawTicker: text, rawName: text, linkedStock: linkedStock || null },
    { dynamicAliases },
  );
}

function expiryToTime(expiry: string): number {
  const t = new Date(expiry).getTime();
  return Number.isFinite(t) ? t : 0;
}

function sigLabel(sig: PositionSignature): string {
  const side = sig.quantity_sign < 0 ? 'V' : 'A';
  const type = (sig.option_type || '?').toUpperCase();
  const qty = (sig.quantity_abs || 1) > 1 ? ` ×${sig.quantity_abs}` : '';
  return `${side} ${type} ${sig.strike} ${sig.expiry}${qty}`;
}

function bucketKey(optionType: string, quantitySign: number): string {
  return `${optionType.toLowerCase()}::${quantitySign}`;
}

/** Trova l'azione/ETF in portafoglio corrispondente a un sottostante (posizione base, senza slot). */
function findStockForUnderlying(
  underlying: string,
  allPositions: Position[],
  dynamicAliases?: Map<string, string> | Record<string, string>,
): Position | undefined {
  const key = normalizeUnderlying(underlying, null, dynamicAliases);
  return allPositions.find(p => {
    if (p.asset_type !== 'stock' && p.asset_type !== 'etf') return false;
    if (/__slot_\d+$/.test(p.id)) return false;
    const stockKey = normalizeUnderlying(p.ticker || p.description || '', null, dynamicAliases);
    return stockKey.length > 0 && (stockKey === key || stockKey.includes(key) || key.includes(stockKey));
  });
}

/** Prezzo spot del sottostante, con fallback su matching normalizzato. */
function spotPriceFor(
  underlying: string,
  prices?: Record<string, { price?: number | null }>,
  dynamicAliases?: Map<string, string> | Record<string, string>,
): number | null {
  if (!prices) return null;
  const direct = prices[underlying]?.price;
  if (typeof direct === 'number' && direct > 0) return direct;
  const key = normalizeUnderlying(underlying, null, dynamicAliases);
  for (const [k, v] of Object.entries(prices)) {
    if (normalizeUnderlying(k, null, dynamicAliases) === key && typeof v?.price === 'number' && v.price > 0) return v.price;
  }
  return null;
}

interface LegCounts {
  soldPuts: PositionSignature[];
  boughtPuts: PositionSignature[];
  soldCalls: PositionSignature[];
  boughtCalls: PositionSignature[];
}

function countLegs(sigs: PositionSignature[]): LegCounts {
  const c: LegCounts = { soldPuts: [], boughtPuts: [], soldCalls: [], boughtCalls: [] };
  for (const s of sigs) {
    const isPut = (s.option_type || '').toLowerCase() === 'put';
    if (isPut) (s.quantity_sign < 0 ? c.soldPuts : c.boughtPuts).push(s);
    else (s.quantity_sign < 0 ? c.soldCalls : c.boughtCalls).push(s);
  }
  return c;
}

function allSameExpiry(sigs: PositionSignature[]): boolean {
  return new Set(sigs.map(s => s.expiry)).size <= 1;
}

function sumQty(sigs: PositionSignature[]): number {
  return sigs.reduce((s, x) => s + (x.quantity_abs || 1), 0);
}

/**
 * REGOLA 4 — Riclassificazione del tipo dalla struttura risultante.
 * `currentType` viene mantenuto quando la struttura non è discriminante
 * (config vuota / stock-only).
 */
export function classifyConfigType(
  sigs: PositionSignature[],
  hasLinkedStock: boolean,
  currentType: string,
): string {
  const { soldPuts, boughtPuts, soldCalls, boughtCalls } = countLegs(sigs);

  if (hasLinkedStock) {
    if (soldCalls.length > 0 && boughtPuts.length > 0) return 'derisking_covered_call';
    if (soldCalls.length > 0) return 'covered_call';
    if (boughtPuts.length > 0) return 'derisking_covered_call';
    return currentType; // stock-only: mantieni l'etichetta scelta
  }

  const has = (n: PositionSignature[]) => n.length > 0;
  if (has(soldPuts) && has(boughtPuts) && has(soldCalls) && has(boughtCalls)) {
    return allSameExpiry(sigs) ? 'iron_condor' : 'double_diagonal';
  }
  if (has(soldPuts) && has(boughtPuts) && !has(soldCalls) && !has(boughtCalls)) {
    return allSameExpiry(sigs) ? 'put_spread' : 'diagonal_put_spread';
  }
  if (has(soldCalls) && has(boughtCalls) && !has(soldPuts) && !has(boughtPuts)) {
    return allSameExpiry(sigs) ? 'call_spread' : 'diagonal_call_spread';
  }
  if (has(soldPuts) && !has(boughtPuts) && !has(soldCalls) && !has(boughtCalls)) return 'naked_put';
  if (has(boughtPuts) && !has(soldPuts) && !has(soldCalls) && !has(boughtCalls)) return 'protection';
  if (has(boughtCalls) && !has(soldCalls) && !has(soldPuts) && !has(boughtPuts)) return 'leap_call';
  if (sigs.length === 0) return currentType;
  return 'other';
}

/** Gamba nuova nel pipeline dei residui (quantità mutabile durante il consumo). */
interface NewLeg {
  positionId: string;
  optionType: string; // 'put' | 'call' (lowercase)
  quantitySign: number; // -1 venduta, +1 comprata
  strike: number;
  expiry: string;
  qty: number;
}

function legToSig(l: NewLeg, qty?: number): PositionSignature {
  return {
    option_type: l.optionType,
    strike: l.strike,
    expiry: l.expiry,
    quantity_sign: l.quantitySign,
    quantity_abs: qty ?? l.qty,
  };
}

interface MissingEntry {
  configId: string;
  sigIndex: number;
  sig: PositionSignature; // quantity_abs = contratti mancanti
}

export function autoReconcileStrategies(
  configs: StrategyConfiguration[],
  items: ReconciliationItem[],
  allPositions: Position[] = [],
  underlyingPrices?: Record<string, { price?: number | null }>,
  dynamicAliases?: Map<string, string> | Record<string, string>,
): AutoReconcileResult {
  const changes: string[] = [];
  const unresolvedItems: ReconciliationItem[] = [];

  // Config di lavoro: mappa id -> firme mutabili (deep copy)
  const workingSigs = new Map<string, (PositionSignature | null)[]>();
  const configById = new Map<string, StrategyConfiguration>();
  for (const c of configs) {
    configById.set(c.id, c);
    workingSigs.set(
      c.id,
      ((c.position_signatures as unknown as PositionSignature[]) || []).map(s => ({ ...s })),
    );
  }
  const deletedConfigIds = new Set<string>();
  const appendedSigs = new Map<string, PositionSignature[]>();
  const touchedConfigIds = new Set<string>();
  const newConfigs: UpsertConfigParams[] = [];
  /** Config create in questo run, indicizzate per (underlyingKey, tipo iniziale) per il chaining */
  const runCreated: { underlyingKey: string; params: UpsertConfigParams }[] = [];

  // Lookup posizione per id (per risolvere l'azione collegata delle config,
  // stesso pattern di strategyReconciliation.ts)
  const positionById = new Map<string, Position>();
  for (const p of allPositions) positionById.set(p.id, p);
  const resolveLinkedStock = (config: StrategyConfiguration): Position | null => {
    if (!config.linked_stock_id) return null;
    return positionById.get(config.linked_stock_id)
      || allPositions.find(p => p.id.startsWith(config.linked_stock_id + '__slot_'))
      || null;
  };

  let anyChange = false;

  /** Firme correnti di una config esistente (originali sopravvissute + accodate) */
  const liveSigsOf = (configId: string): PositionSignature[] => [
    ...(workingSigs.get(configId) || []).filter((s): s is PositionSignature => s !== null),
    ...(appendedSigs.get(configId) || []),
  ];

  // ------------------------------------------------------------------
  // Raggruppa gli item per sottostante normalizzato
  // ------------------------------------------------------------------
  const itemsByUnderlying = new Map<string, ReconciliationItem[]>();
  for (const item of items) {
    const key = normalizeUnderlying(item.underlying, resolveLinkedStock(item.config), dynamicAliases);
    if (!itemsByUnderlying.has(key)) itemsByUnderlying.set(key, []);
    itemsByUnderlying.get(key)!.push(item);
  }

  for (const [underlyingKey, underlyingItems] of itemsByUnderlying) {
    const realItems = underlyingItems.filter(i => !i.config.id.startsWith('__new__'));
    const underlyingLabel = underlyingItems[0].underlying;

    // ---- Raccolta gambe missing (solo config reali) ----
    const missing: MissingEntry[] = [];
    for (const item of realItems) {
      const sigs = workingSigs.get(item.config.id) || [];
      for (const leg of item.legs) {
        if (leg.status !== 'missing') continue;
        const idx = sigs.findIndex(
          s => s !== null &&
            (s.option_type || '').toLowerCase() === (leg.signature.option_type || '').toLowerCase() &&
            Math.abs(s.strike - leg.signature.strike) < 0.01 &&
            s.expiry === leg.signature.expiry &&
            s.quantity_sign === leg.signature.quantity_sign,
        );
        if (idx >= 0) missing.push({ configId: item.config.id, sigIndex: idx, sig: { ...leg.signature } });
      }
    }

    // ---- Gambe new dedupe per position id ----
    const newByPosId = new Map<string, NewLeg>();
    for (const item of underlyingItems) {
      for (const leg of item.legs) {
        if (leg.status !== 'new' || !leg.position) continue;
        if (newByPosId.has(leg.position.id)) continue;
        newByPosId.set(leg.position.id, {
          positionId: leg.position.id,
          optionType: (leg.position.option_type || '').toLowerCase(),
          quantitySign: leg.position.quantity >= 0 ? 1 : -1,
          strike: leg.position.strike_price || 0,
          expiry: leg.position.expiry_date || '',
          qty: Math.abs(leg.position.quantity),
        });
      }
    }

    // ------------------------------------------------------------------
    // REGOLA 1: ROLL — appaiamento per bucket (type, sign)
    // ------------------------------------------------------------------
    const missingByBucket = new Map<string, MissingEntry[]>();
    for (const m of missing) {
      const k = bucketKey(m.sig.option_type, m.sig.quantity_sign);
      if (!missingByBucket.has(k)) missingByBucket.set(k, []);
      missingByBucket.get(k)!.push(m);
    }
    const newByBucket = new Map<string, NewLeg[]>();
    for (const n of newByPosId.values()) {
      const k = bucketKey(n.optionType, n.quantitySign);
      if (!newByBucket.has(k)) newByBucket.set(k, []);
      newByBucket.get(k)!.push(n);
    }

    /** posizione (parzialmente) consumata da un roll → config di destinazione */
    const rollTargetByPosId = new Map<string, { configId: string; rolledSig: PositionSignature }>();

    for (const [bucket, missingList] of missingByBucket) {
      const candidates = (newByBucket.get(bucket) || []);
      missingList.sort((a, b) => a.sig.strike - b.sig.strike || expiryToTime(a.sig.expiry) - expiryToTime(b.sig.expiry));
      candidates.sort((a, b) => a.strike - b.strike || expiryToTime(a.expiry) - expiryToTime(b.expiry));

      let ci = 0;
      for (const m of missingList) {
        const needed = m.sig.quantity_abs || 1;
        while (ci < candidates.length && candidates[ci].qty <= 0) ci++;
        const cand = ci < candidates.length ? candidates[ci] : undefined;

        const sigs = workingSigs.get(m.configId)!;
        const cfg = configById.get(m.configId)!;
        touchedConfigIds.add(m.configId);

        if (cand) {
          const take = Math.min(needed, cand.qty);
          cand.qty -= take;
          const oldLabel = sigLabel(m.sig);
          const newSig: PositionSignature = legToSig(cand, take);
          rollTargetByPosId.set(cand.positionId, { configId: m.configId, rolledSig: newSig });

          const original = sigs[m.sigIndex];
          if (original && (original.quantity_abs || 1) > needed) {
            // Parte della firma è ancora presente: riduci l'originale e aggiungi la nuova
            original.quantity_abs = (original.quantity_abs || 1) - needed;
            sigs.push(newSig);
          } else {
            sigs[m.sigIndex] = newSig;
          }
          changes.push(`${cfg.underlying} (${cfg.strategy_type}): roll ${oldLabel} → ${sigLabel(newSig)}`);
          anyChange = true;
          if (take < needed) {
            changes.push(`${cfg.underlying} (${cfg.strategy_type}): ridotta di ${needed - take} contratti su ${oldLabel}`);
          }
        } else {
          // REGOLA 2: nessuna candidata → gamba rimossa
          const original = sigs[m.sigIndex];
          if (original) {
            if ((original.quantity_abs || 1) > needed) {
              original.quantity_abs = (original.quantity_abs || 1) - needed;
            } else {
              sigs[m.sigIndex] = null;
            }
          }
          changes.push(`${cfg.underlying} (${cfg.strategy_type}): gamba chiusa ${sigLabel(m.sig)} (rimossa)`);
          anyChange = true;
        }
      }
    }

    // ------------------------------------------------------------------
    // REGOLA 1 (coda): quantità residua su posizioni GIÀ toccate da un roll
    // → resta nella stessa strategia (aumento di quantità del roll)
    // ------------------------------------------------------------------
    for (const n of newByPosId.values()) {
      if (n.qty <= 0) continue;
      const rollTarget = rollTargetByPosId.get(n.positionId);
      if (!rollTarget) continue;
      const cfg = configById.get(rollTarget.configId)!;
      // Accorpa direttamente nella firma rollata (stesso strike/scadenza)
      rollTarget.rolledSig.quantity_abs = (rollTarget.rolledSig.quantity_abs || 1) + n.qty;
      changes.push(`${cfg.underlying} (${cfg.strategy_type}): quantità aumentata di ${n.qty} su ${sigLabel(rollTarget.rolledSig)}`);
      touchedConfigIds.add(rollTarget.configId);
      n.qty = 0;
      anyChange = true;
    }

    // ------------------------------------------------------------------
    // REGOLA 3: pipeline dei residui (gambe nuove non-roll)
    // ------------------------------------------------------------------
    const leftovers = [...newByPosId.values()].filter(n => n.qty > 0);
    if (leftovers.length > 0) {
      const configsForUnderlying = configs.filter(
        c => normalizeUnderlying(c.underlying, resolveLinkedStock(c), dynamicAliases) === underlyingKey && !deletedConfigIds.has(c.id),
      );

      const createConfig = (strategyType: string, sigs: PositionSignature[], linkedStockId: string | null = null): UpsertConfigParams => {
        const params: UpsertConfigParams = {
          underlying: underlyingLabel,
          strategy_type: strategyType,
          position_signatures: sigs,
          is_synthetic: false,
          linked_stock_id: linkedStockId,
          linked_stock_slot_ids: [],
        };
        newConfigs.push(params);
        runCreated.push({ underlyingKey, params });
        changes.push(`${underlyingLabel}: nuova strategia ${strategyType} creata automaticamente (${sigs.map(sigLabel).join(', ')})`);
        anyChange = true;
        return params;
      };
      const appendToExisting = (target: StrategyConfiguration, sig: PositionSignature, extra?: string) => {
        if (!appendedSigs.has(target.id)) appendedSigs.set(target.id, []);
        appendedSigs.get(target.id)!.push(sig);
        touchedConfigIds.add(target.id);
        changes.push(`${target.underlying} (${target.strategy_type}): aggiunta gamba ${sigLabel(sig)}${extra ? ` — ${extra}` : ''}`);
        anyChange = true;
      };
      const findExistingOfType = (...types: string[]) =>
        configsForUnderlying.find(c => types.includes(c.strategy_type));
      const findRunCreatedOfType = (...types: string[]) =>
        runCreated.find(rc => rc.underlyingKey === underlyingKey && types.includes(rc.params.strategy_type))?.params;

      // -- 3a: tutti e 4 i ruoli presenti → un'unica IC/DD --
      const lc = { sp: leftovers.filter(l => l.optionType === 'put' && l.quantitySign === -1),
                   bp: leftovers.filter(l => l.optionType === 'put' && l.quantitySign === 1),
                   sc: leftovers.filter(l => l.optionType === 'call' && l.quantitySign === -1),
                   bc: leftovers.filter(l => l.optionType === 'call' && l.quantitySign === 1) };
      if (lc.sp.length > 0 && lc.bp.length > 0 && lc.sc.length > 0 && lc.bc.length > 0) {
        const sigs = leftovers.map(l => legToSig(l));
        const type = allSameExpiry(sigs) ? 'iron_condor' : 'double_diagonal';
        createConfig(type, sigs);
        leftovers.forEach(l => { l.qty = 0; });
      } else {
        // -- 3b: coppie venduta+comprata dello stesso tipo → spread --
        for (const optType of ['put', 'call'] as const) {
          const sold = leftovers.filter(l => l.optionType === optType && l.quantitySign === -1 && l.qty > 0)
            .sort((a, b) => a.strike - b.strike || expiryToTime(a.expiry) - expiryToTime(b.expiry));
          const bought = leftovers.filter(l => l.optionType === optType && l.quantitySign === 1 && l.qty > 0)
            .sort((a, b) => a.strike - b.strike || expiryToTime(a.expiry) - expiryToTime(b.expiry));
          let si = 0, bi = 0;
          while (si < sold.length && bi < bought.length) {
            const s = sold[si], b = bought[bi];
            const q = Math.min(s.qty, b.qty);
            const pairSigs = [legToSig(s, q), legToSig(b, q)];
            const sameExp = s.expiry === b.expiry;
            const type = optType === 'put'
              ? (sameExp ? 'put_spread' : 'diagonal_put_spread')
              : (sameExp ? 'call_spread' : 'diagonal_call_spread');
            createConfig(type, pairSigs);
            s.qty -= q; b.qty -= q;
            if (s.qty <= 0) si++;
            if (b.qty <= 0) bi++;
          }
        }

        // -- 3c..3f: regole per-gamba sui residui, in ordine deterministico --
        // Ordine: put vendute, call vendute, put comprate, call comprate —
        // così una call venduta può creare la CC su cui poi si appoggia la
        // put comprata (→ de-risking) nello stesso run.
        const remaining = leftovers.filter(l => l.qty > 0);

        // 3c: put vendute residue → UNA nuova naked_put per run
        const soldPuts = remaining.filter(l => l.optionType === 'put' && l.quantitySign === -1);
        if (soldPuts.length > 0) {
          createConfig('naked_put', soldPuts.map(l => legToSig(l)));
          soldPuts.forEach(l => { l.qty = 0; });
        }

        // 3e: call vendute residue
        const soldCalls = remaining.filter(l => l.optionType === 'call' && l.quantitySign === -1 && l.qty > 0);
        for (const l of soldCalls) {
          const sig = legToSig(l);
          const ccLike = findExistingOfType('covered_call', 'derisking_covered_call');
          if (ccLike) {
            appendToExisting(ccLike, sig);
          } else {
            const runCc = findRunCreatedOfType('covered_call', 'derisking_covered_call');
            if (runCc) {
              runCc.position_signatures.push(sig);
              changes.push(`${underlyingLabel}: aggiunta gamba ${sigLabel(sig)} alla covered call appena creata`);
            } else {
              const stock = findStockForUnderlying(underlyingLabel, allPositions, dynamicAliases);
              if (stock) createConfig('covered_call', [sig], stock.id);
              else createConfig('other', [sig]);
            }
          }
          l.qty = 0;
        }

        // 3d: put comprate residue
        const boughtPuts = remaining.filter(l => l.optionType === 'put' && l.quantitySign === 1 && l.qty > 0);
        for (const l of boughtPuts) {
          const sig = legToSig(l);
          const cc = findExistingOfType('covered_call');
          const drcc = findExistingOfType('derisking_covered_call');
          const np = findExistingOfType('naked_put');
          const spread = findExistingOfType('put_spread', 'diagonal_put_spread');
          const runCc = findRunCreatedOfType('covered_call');

          if (cc) {
            appendToExisting(cc, sig, 'covered call trasformata in de-risking');
          } else if (runCc) {
            runCc.position_signatures.push(sig);
            runCc.strategy_type = 'derisking_covered_call';
            changes.push(`${underlyingLabel}: la covered call appena creata diventa de-risking (${sigLabel(sig)})`);
          } else if (drcc) {
            // Check copertura: parziale → accorpa, completa → protection separata
            if (isDeRiskingProtectionPartial(drcc, liveSigsOf(drcc.id), allPositions, underlyingPrices, dynamicAliases)) {
              appendToExisting(drcc, sig, 'protezione integrata (copertura parziale)');
            } else {
              createConfig('protection', [sig]);
            }
          } else if (np) {
            appendToExisting(np, sig, 'naked put trasformata in spread');
          } else if (spread) {
            appendToExisting(spread, sig);
          } else {
            createConfig('protection', [sig]);
          }
          l.qty = 0;
        }

        // 3f: call comprate residue → UNA nuova leap_call per run
        const boughtCalls = remaining.filter(l => l.optionType === 'call' && l.quantitySign === 1 && l.qty > 0);
        if (boughtCalls.length > 0) {
          createConfig('leap_call', boughtCalls.map(l => legToSig(l)));
          boughtCalls.forEach(l => { l.qty = 0; });
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // REGOLA 2 (coda): chiusura strategie rimaste senza firme
  // ------------------------------------------------------------------
  for (const [configId, sigs] of workingSigs) {
    const cfg = configById.get(configId)!;
    const remaining = sigs.filter((s): s is PositionSignature => s !== null);
    const appended = appendedSigs.get(configId) || [];
    const hasLinkedStock = !!cfg.linked_stock_id || (cfg.linked_stock_slot_ids || []).length > 0;
    if (remaining.length + appended.length === 0 && !hasLinkedStock && touchedConfigIds.has(configId)) {
      deletedConfigIds.add(configId);
      changes.push(`${cfg.underlying} (${cfg.strategy_type}): strategia chiusa, configurazione eliminata`);
      anyChange = true;
    }
  }

  if (!anyChange) {
    return { resolvedConfigs: null, changes: [], unresolvedItems, hasAutoChanges: false };
  }

  // ------------------------------------------------------------------
  // Ricostruzione del set completo (upsertBatch = full replace)
  // + REGOLA 4: retype dalla struttura risultante per le config toccate
  // ------------------------------------------------------------------
  const resolvedConfigs: UpsertConfigParams[] = [];
  for (const c of configs) {
    if (deletedConfigIds.has(c.id)) continue;
    const finalSigs = [
      ...(workingSigs.get(c.id) || []).filter((s): s is PositionSignature => s !== null),
      ...(appendedSigs.get(c.id) || []),
    ];
    const hasLinkedStock = !!c.linked_stock_id || (c.linked_stock_slot_ids || []).length > 0;
    let strategyType = c.strategy_type;
    if (touchedConfigIds.has(c.id)) {
      const newType = classifyConfigType(finalSigs, hasLinkedStock, c.strategy_type);
      if (newType !== c.strategy_type) {
        changes.push(`${c.underlying}: strategia riclassificata ${c.strategy_type} → ${newType}`);
        strategyType = newType;
      }
    }
    resolvedConfigs.push({
      underlying: c.underlying,
      strategy_type: strategyType,
      position_signatures: finalSigs,
      is_synthetic: c.is_synthetic,
      linked_stock_id: c.linked_stock_id,
      linked_stock_slot_ids: c.linked_stock_slot_ids || [],
      sort_order: c.sort_order,
    });
  }
  const maxSort = configs.reduce((m, c) => Math.max(m, c.sort_order || 0), 0);
  newConfigs.forEach((nc, i) => {
    resolvedConfigs.push({ ...nc, sort_order: maxSort + 1 + i });
  });

  return { resolvedConfigs, changes, unresolvedItems, hasAutoChanges: true };
}

/**
 * REGOLA 3d — Copertura della protezione di una de-risking covered call.
 * Esposizione da coprire = azioni/100 + contratti long call + contratti
 * short put ITM (ITM assunto quando il prezzo del sottostante non è noto).
 * La protezione è PARZIALE quando i contratti di put comprata sono inferiori
 * all'esposizione: in quel caso la nuova put comprata si accorpa.
 */
export function isDeRiskingProtectionPartial(
  config: StrategyConfiguration,
  currentSigs: PositionSignature[],
  allPositions: Position[],
  underlyingPrices?: Record<string, { price?: number | null }>,
  dynamicAliases?: Map<string, string> | Record<string, string>,
): boolean {
  const { soldPuts, boughtPuts, boughtCalls } = countLegs(currentSigs);

  // Azioni collegate (posizione base + eventuali slot)
  let shares = 0;
  const stockIds = new Set<string>();
  if (config.linked_stock_id) stockIds.add(config.linked_stock_id);
  for (const sid of config.linked_stock_slot_ids || []) stockIds.add(sid);
  if (stockIds.size > 0) {
    for (const p of allPositions) {
      const matches = [...stockIds].some(sid => p.id === sid || p.id.startsWith(sid + '__slot_'));
      if (matches) shares += Math.abs(p.quantity || 0);
    }
  }
  if (shares === 0) {
    const stock = findStockForUnderlying(config.underlying, allPositions, dynamicAliases);
    if (stock) shares = Math.abs(stock.quantity || 0);
  }

  const spot = spotPriceFor(config.underlying, underlyingPrices, dynamicAliases);
  const itmShortPutContracts = soldPuts.reduce((s, sig) => {
    const itm = spot === null ? true : sig.strike > spot; // prezzo ignoto → conta come ITM
    return s + (itm ? (sig.quantity_abs || 1) : 0);
  }, 0);

  const exposure = Math.round(shares / 100) + sumQty(boughtCalls) + itmShortPutContracts;
  const protection = sumQty(boughtPuts);
  return protection < exposure;
}
