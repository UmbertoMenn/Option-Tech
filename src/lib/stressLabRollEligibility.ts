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

/** rollQ firmato (≤ 0) per una gamba di quantità q, limitato a |q|. */
export function rollQForLeg(q: number, eligibleQty: number | undefined): number {
  if (q >= 0 || !eligibleQty || eligibleQty <= 0) return 0;
  return -Math.min(Math.abs(q), eligibleQty);
}
