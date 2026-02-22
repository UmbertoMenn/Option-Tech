/**
 * Covered Call adjustment rules – interactive question-based system.
 */

export interface ApproachRule {
  activationPct: number; // % distance from sold call strike
  action: 'roll_up_always' | 'roll_up_positive' | 'do_nothing';

  // roll_up_positive params
  minPremiumUsd: number;

  // expiry params (always visible)
  newCallBarrierPct: number;

  // roll up min distance
  rollUpMinDistancePct: number; // min % distance of new strike from underlying price
}

export interface ProfitRule {
  profitPct: number; // % gain threshold (e.g. 80 = option lost 80% value)
  action: 'wait_and_sell' | 'roll_down';

  // wait_and_sell
  newCallBarrierPct: number;

  // roll_down_first_expiry
  firstExpiryMinDistancePct: number;
  minPremiumUsd: number;

  // roll_down_any_expiry
  minDistancePct: number;
  rollDownMinPremiumUsd: number;
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
      action: 'roll_up_always',
      minPremiumUsd: 0.50,
      newCallBarrierPct: 5,
      rollUpMinDistancePct: 5,
    },
    profitRule: {
      profitPct: 50,
      action: 'roll_down',
      newCallBarrierPct: 5,
      firstExpiryMinDistancePct: 5,
      minPremiumUsd: 0.50,
      minDistancePct: 5,
      rollDownMinPremiumUsd: 0.50,
    },
  };
}

/**
 * Round a strike to the nearest multiple of strikeStep.
 */
export function roundStrike(target: number, strikeStep: number): number {
  return Math.round(target / strikeStep) * strikeStep;
}
