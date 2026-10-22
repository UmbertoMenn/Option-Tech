/**
 * Equity Exposure: totali filtrati per PUT/CALL ITM/OTM e scadenza.
 *
 * Il filtro agisce SOLO sulle categorie fatte di opzioni (Naked PUT, Leap Call,
 * Strategie, CC/DR-CC sintetiche): ogni voce resta se almeno una sua gamba
 * soddisfa il filtro (una strategia non si spezza, il suo Max Loss conta per
 * intero). Azioni, ETF, commodities e GP non sono derivati e restano invariati,
 * compreso l'effetto delle protezioni PUT sulle azioni reali.
 */
import type { RiskAnalysis } from '@/lib/riskCalculator';
import { anyLegMatches, isOptionLegFilterActive, type FilterableLeg, type OptionLegFilter } from '@/lib/optionLegFilter';

const legsOf = (d: { legs?: FilterableLeg[] }): FilterableLeg[] => d.legs ?? [];

export function filterRiskAnalysisByOptionLegs(analysis: RiskAnalysis, f: OptionLegFilter): RiskAnalysis {
  if (!isOptionLegFilterActive(f)) return analysis;
  const keep = <T extends { legs?: FilterableLeg[] }>(arr: T[]) => arr.filter((d) => anyLegMatches(legsOf(d), f));

  const nakedPutDetails = keep(analysis.nakedPutDetails);
  const leapCallDetails = keep(analysis.leapCallDetails);
  const strategyDetails = keep(analysis.strategyDetails);
  const syntheticCcDrccDetails = keep(analysis.syntheticCcDrccDetails);

  const totalNakedPutRisk = nakedPutDetails.reduce((s, d) => s + d.riskEUR, 0);
  const totalLeapCallRisk = leapCallDetails.reduce((s, d) => s + d.riskEUR, 0);
  const totalStrategyRisk = strategyDetails.reduce((s, d) => s + d.maxLossEUR, 0);
  const totalSyntheticCcDrccRisk = syntheticCcDrccDetails.reduce((s, d) => s + d.riskEUR, 0);

  return {
    ...analysis,
    nakedPutDetails,
    leapCallDetails,
    strategyDetails,
    syntheticCcDrccDetails,
    totalNakedPutRisk,
    totalLeapCallRisk,
    totalStrategyRisk,
    totalSyntheticCcDrccRisk,
    grandTotal:
      analysis.totalStockRisk +
      analysis.totalCommodityRisk +
      totalNakedPutRisk +
      totalLeapCallRisk +
      totalStrategyRisk +
      totalSyntheticCcDrccRisk,
  };
}

/** Gambe di ogni voce derivata, per i conteggi dei pulsanti filtro. */
export function riskAnalysisOptionItemsLegs(analysis: RiskAnalysis): FilterableLeg[][] {
  return [
    ...analysis.nakedPutDetails.map(legsOf),
    ...analysis.leapCallDetails.map(legsOf),
    ...analysis.strategyDetails.map(legsOf),
    ...analysis.syntheticCcDrccDetails.map(legsOf),
  ];
}

export interface DerivativeExposureToggles {
  includeNakedPut: boolean;
  includeLeapCall: boolean;
  includeStrategies: boolean;
  /** Sintetiche al netto (true) o al lordo (false) delle PUT di protezione. */
  includeProtections: boolean;
}

/** Somma EUR delle categorie derivate (rispettando i toggle della card). */
export function derivativeExposureTotal(analysis: RiskAnalysis, t: DerivativeExposureToggles): number {
  const synth = t.includeProtections
    ? analysis.totalSyntheticCcDrccRisk
    : analysis.syntheticCcDrccDetails.reduce((s, d) => s + (d.riskEURWithoutProtection ?? d.riskEUR), 0);
  return (
    (t.includeNakedPut ? analysis.totalNakedPutRisk : 0) +
    (t.includeLeapCall ? analysis.totalLeapCallRisk : 0) +
    (t.includeStrategies ? analysis.totalStrategyRisk : 0) +
    synth
  );
}
