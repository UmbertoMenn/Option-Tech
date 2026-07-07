/**
 * Destrutturazione del premio di mercato di un'opzione in componenti di edge.
 *
 * Il premio di mercato incorpora due "scostamenti" rispetto al valore atteso reale:
 *  1. Volatilità: il mercato prezza con IV, il titolo si muove con RV (vol realizzata).
 *  2. Deriva: il mercato prezza risk-neutral (drift = r), il titolo ha deriva reale μ.
 *
 * Tre confronti isolano le componenti:
 *  - bsRealVol        → vol reale RV, deriva B&S (r):   isola l'edge da volatilità
 *  - realDriftImplVol → vol implicita IV, deriva reale: isola l'edge da deriva
 *  - realDriftRealVol → vol reale RV, deriva reale:     edge totale (= Edge Reale)
 *
 * Identità: edgeTotal = edgeVol + edgeDrift + interaction
 * (l'interazione è il termine incrociato vol×deriva, in genere piccolo).
 */
import { bsPrice, cdf } from './blackScholes';

export type OptionSide = 'CALL' | 'PUT';

/**
 * Valore atteso attuariale dell'opzione in misura reale:
 * payoff atteso sotto GBM con deriva del prezzo m, scontato al risk-free r.
 * Con m = r coincide con Black-Scholes.
 */
export function realOptionValue(
  S: number,
  K: number,
  T: number,
  r: number,
  m: number,
  sigma: number,
  type: OptionSide,
): number {
  if (T <= 0 || sigma <= 0) {
    const F = S * Math.exp(Math.max(T, 0) * m);
    const intr = type === 'CALL' ? Math.max(F - K, 0) : Math.max(K - F, 0);
    return Math.exp(-r * Math.max(T, 0)) * intr;
  }
  const v = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (m + (sigma * sigma) / 2) * T) / v;
  const d2 = d1 - v;
  return type === 'CALL'
    ? S * Math.exp((m - r) * T) * cdf(d1) - K * Math.exp(-r * T) * cdf(d2)
    : K * Math.exp(-r * T) * cdf(-d2) - S * Math.exp((m - r) * T) * cdf(-d1);
}

export interface PremiumDecompositionParams {
  S: number;
  K: number;
  T: number;
  /** risk-free (decimale, es. 0.04) */
  r: number;
  /** deriva reale del prezzo (decimale), tipicamente CAPM − dividend yield */
  m: number;
  /** volatilità implicita (decimale) */
  iv: number;
  /** volatilità reale/realizzata (decimale) */
  rv: number;
  type: OptionSide;
  /** premio di mercato incassato */
  marketPremium: number;
}

export interface PremiumDecomposition {
  /** Premio reale 1: vol reale RV, deriva B&S (risk-neutral r) */
  bsRealVol: number;
  /** Premio reale 2: vol implicita IV, deriva reale μ */
  realDriftImplVol: number;
  /** Premio reale 3: vol reale RV, deriva reale μ (= valore reale) */
  realDriftRealVol: number;
  /** marketPremium − bsRealVol: edge da volatilità (premio di varianza in €) */
  edgeVol: number;
  /** marketPremium − realDriftImplVol: edge da deriva */
  edgeDrift: number;
  /** marketPremium − realDriftRealVol: edge totale (= Edge Reale) */
  edgeTotal: number;
  /** edgeTotal − edgeVol − edgeDrift: termine incrociato vol×deriva */
  interaction: number;
}

export function premiumDecomposition(p: PremiumDecompositionParams): PremiumDecomposition {
  const { S, K, T, r, m, iv, rv, type, marketPremium } = p;
  const bsType = type === 'CALL' ? 'call' : 'put';
  const bsRealVol = bsPrice(S, K, T, r, rv, bsType);
  const realDriftImplVol = isFinite(iv) ? realOptionValue(S, K, T, r, m, iv, type) : NaN;
  const realDriftRealVol = realOptionValue(S, K, T, r, m, rv, type);
  const edgeVol = marketPremium - bsRealVol;
  const edgeDrift = marketPremium - realDriftImplVol;
  const edgeTotal = marketPremium - realDriftRealVol;
  return {
    bsRealVol,
    realDriftImplVol,
    realDriftRealVol,
    edgeVol,
    edgeDrift,
    edgeTotal,
    interaction: edgeTotal - edgeVol - edgeDrift,
  };
}
