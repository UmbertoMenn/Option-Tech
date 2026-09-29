/**
 * Idoneità al ROLLING nello Stress Lab.
 *
 * Regola (Umberto, 28/09/2026): si rollano in discesa SOLO le put vendute di
 *  - naked put;
 *  - put spread e diagonal put spread (verticali bull/bear inclusi), configurati
 *    (strategy_type put_spread / diagonal_put_spread) o riconosciuti in automatico.
 * Escluse: put vendute di covered call sintetiche / DR-CC, iron condor, double diagonal
 * e ogni altra struttura.
 *
 * La classificazione è quella CANONICA di categorizeDerivatives: qui si leggono solo le
 * categorie già calcolate. Le posizioni virtuali (config quantity-aware) portano suffissi
 * __opt_slot_N / __slot_N: si risale all'id raw e si somma la quantità idonea, così una
 * posizione solo in parte in una strategia idonea viene rollata solo per quella parte.
 */
import type { DerivativeCategories } from '@/lib/derivativeStrategies';
import type { Position } from '@/types/portfolio';

const ELIGIBLE_CONFIG_TYPES = new Set(['put_spread', 'diagonal_put_spread']);
const ELIGIBLE_AUTO_NAME = /put spread/i;

export function rawPositionId(id: string): string {
  return id.replace(/__opt_slot_\d+$/, '').replace(/__slot_\d+$/, '');
}

const isSoldPut = (p: Position) => p.option_type === 'put' && (p.quantity ?? 0) < 0;

/**
 * Mappa id raw della posizione → contratti venduti idonei al rolling (valore positivo).
 */
export function rollableShortPutQty(
  cats: Pick<DerivativeCategories, 'nakedPuts' | 'groupedOtherStrategies'>,
): Map<string, number> {
  const out = new Map<string, number>();
  const add = (p: Position) => {
    if (!isSoldPut(p)) return;
    const id = rawPositionId(p.id);
    out.set(id, (out.get(id) ?? 0) + Math.abs(p.quantity));
  };

  for (const np of cats.nakedPuts) add(np.option);

  for (const g of cats.groupedOtherStrategies) {
    const eligible = g.configStrategyType
      ? ELIGIBLE_CONFIG_TYPES.has(g.configStrategyType)
      : !!g.strategyName && ELIGIBLE_AUTO_NAME.test(g.strategyName);
    if (!eligible) continue;
    for (const o of g.options) add(o.option);
  }
  return out;
}

/**
 * Put vendute di SPREAD (diagonal put spread / put spread) → scadenza massima delle put di
 * arrivo = scadenza della put COMPRATA del gruppo (la più lunga se più d'una). Le naked put
 * non compaiono (usano il cap "mesi dal roll" della card). Per un put spread verticale la
 * put comprata ha la stessa scadenza della venduta → nessun roll possibile.
 * Se la stessa posizione è in più gruppi si tiene la scadenza più vicina (prudenziale).
 */
export function rollableShortPutMaxExpiry(
  cats: Pick<DerivativeCategories, 'groupedOtherStrategies'>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const g of cats.groupedOtherStrategies) {
    const eligible = g.configStrategyType
      ? ELIGIBLE_CONFIG_TYPES.has(g.configStrategyType)
      : !!g.strategyName && ELIGIBLE_AUTO_NAME.test(g.strategyName);
    if (!eligible) continue;
    const longExp = g.options
      .map((o) => o.option)
      .filter((p) => p.option_type === 'put' && (p.quantity ?? 0) > 0 && !!p.expiry_date)
      .map((p) => p.expiry_date as string)
      .sort()
      .pop();
    if (!longExp) continue;
    for (const o of g.options) {
      if (!isSoldPut(o.option)) continue;
      const id = rawPositionId(o.option.id);
      const prev = out.get(id);
      if (!prev || longExp < prev) out.set(id, longExp);
    }
  }
  return out;
}

/** rollQ firmato (≤ 0) per una gamba di quantità q, limitato a |q|. */
export function rollQForLeg(q: number, eligibleQty: number | undefined): number {
  if (q >= 0 || !eligibleQty || eligibleQty <= 0) return 0;
  return -Math.min(Math.abs(q), eligibleQty);
}

const CONFIG_TYPE_LABEL: Record<string, string> = {
  other: 'Altra strategia (config)',
  iron_condor: 'Iron condor',
  double_diagonal: 'Double diagonal',
  covered_call: 'Covered call',
  derisking_covered_call: 'DR-CC',
  call_spread: 'Call spread',
  diagonal_call_spread: 'Diagonal call spread',
};

/**
 * Perché una put venduta NON è idonea al rolling: id raw → categoria canonica in cui è
 * finita (covered call sintetica, DR-CC, iron condor, altre strategie, config incompleta…).
 * Le put idonee (naked put / put spread) non compaiono. Serve alla UI per spiegare le
 * esclusioni.
 */
export function rollExclusionReasons(
  cats: Pick<
    DerivativeCategories,
    | 'coveredCalls'
    | 'deRiskingCoveredCalls'
    | 'ironCondors'
    | 'doubleDiagonals'
    | 'groupedOtherStrategies'
    | 'incompleteStrategies'
  >,
): Map<string, string> {
  const out = new Map<string, string>();
  const set = (p: Position | undefined, why: string) => {
    if (!p || !isSoldPut(p)) return;
    const id = rawPositionId(p.id);
    if (!out.has(id)) out.set(id, why);
  };
  for (const cc of cats.coveredCalls) set(cc.syntheticPut, 'Covered call sintetica');
  for (const dr of cats.deRiskingCoveredCalls) set(dr.syntheticPut ?? dr.coveredCall.syntheticPut, 'DR-CC sintetica');
  for (const ic of cats.ironCondors) set(ic.soldPut, 'Iron condor');
  for (const dd of cats.doubleDiagonals) set(dd.soldPut, 'Double diagonal');
  for (const g of cats.groupedOtherStrategies) {
    const eligible = g.configStrategyType
      ? ELIGIBLE_CONFIG_TYPES.has(g.configStrategyType)
      : !!g.strategyName && ELIGIBLE_AUTO_NAME.test(g.strategyName);
    if (eligible) continue;
    let why: string;
    if (g.configStrategyType) {
      const t = CONFIG_TYPE_LABEL[g.configStrategyType] ?? `Config ${g.configStrategyType}`;
      why = g.strategyName ? `${t}: ${g.strategyName}` : t;
    } else if (g.strategyName) {
      why = `Altre strategie: ${g.strategyName}`;
    } else {
      why = 'Altre strategie (non abbinata alla configurazione salvata)';
    }
    for (const o of g.options) set(o.option, why);
  }
  for (const inc of cats.incompleteStrategies) {
    const t = CONFIG_TYPE_LABEL[inc.strategyType] ?? inc.strategyType;
    for (const p of inc.presentLegs) set(p, `${t}${inc.isSynthetic ? ' sintetica' : ''} incompleta`);
  }
  return out;
}
