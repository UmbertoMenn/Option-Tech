/**
 * Covered Call adjustment rules – interactive question-based system.
 */

export interface ApproachRule {
  activationPct: number; // % distance from sold call strike
  minPremiumPct: number; // min additional premium as % of underlying price
  rollUpMinDistancePct: number; // min % distance of new strike from underlying price
}

export interface ProfitRule {
  profitPct: number; // % gain threshold (e.g. 50 = option lost 50% value)
  action: 'dynamic' | 'static';

  // First expiry (shared by both modes)
  firstExpiryMinDistancePct: number; // min % distance of strike from underlying
  firstExpiryMinPremiumPct: number;  // min premium as % of underlying price

  // Rolling Dinamico – later expiries
  dynamicAnnualizedPremiumPct: number; // annualized net premium threshold %
  dynamicMinDistancePct: number;       // min % distance of strike from underlying

  // Rolling Statico – later expiries
  staticMinDistancePct: number;    // min % distance of strike from underlying
  staticMinPremiumPct: number;     // min net premium as % of underlying price
}

export interface CoveredCallRules {
  strikeStep: number;
  approachRule: ApproachRule;
  profitRule: ProfitRule;
}

export function getDefaultCoveredCallRules(): CoveredCallRules {
  return {
    strikeStep: 5,
    approachRule: {
      activationPct: 2,
      minPremiumPct: 0.5,
      rollUpMinDistancePct: 5,
    },
    profitRule: {
      profitPct: 50,
      action: 'dynamic',
      firstExpiryMinDistancePct: 5,
      firstExpiryMinPremiumPct: 0.5,
      dynamicAnnualizedPremiumPct: 10,
      dynamicMinDistancePct: 5,
      staticMinDistancePct: 5,
      staticMinPremiumPct: 0.5,
    },
  };
}

/**
 * Round a strike to the nearest multiple of strikeStep.
 */
export function roundStrike(target: number, strikeStep: number): number {
  return Math.round(target / strikeStep) * strikeStep;
}
