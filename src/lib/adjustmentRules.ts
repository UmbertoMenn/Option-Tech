/**
 * Covered Call adjustment rules – interactive question-based system.
 */

export interface ApproachRule {
  enabled: boolean;
  activationPct: number; // % distance from sold call strike
  action: 'roll_up_always' | 'roll_up_positive' | 'do_nothing';

  // roll_up_positive params
  minPremiumUsd: number;
  minPremiumPct: number;

  // do_nothing expiry params
  expiryAction: 'sell_new_call' | 'rebuy_and_sell';
  newCallBarrierPct: number;
}

export interface ProfitRule {
  enabled: boolean;
  profitPct: number; // % gain threshold (e.g. 80 = option lost 80% value)
  action: 'wait_and_sell' | 'roll_down';

  // wait_and_sell
  newCallBarrierPct: number;

  // roll_down_first_expiry
  minPremiumUsd: number;
  minPremiumPct: number;

  // roll_down_any_expiry
  minDistancePct: number;
  rollDownMinPremiumUsd: number;
  rollDownMinPremiumPct: number;
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
      enabled: true,
      activationPct: 2,
      action: 'roll_up_always',
      minPremiumUsd: 0.50,
      minPremiumPct: 0.5,
      expiryAction: 'sell_new_call',
      newCallBarrierPct: 5,
    },
    profitRule: {
      enabled: true,
      profitPct: 80,
      action: 'wait_and_sell',
      newCallBarrierPct: 5,
      minPremiumUsd: 0.50,
      minPremiumPct: 0.5,
      minDistancePct: 5,
      rollDownMinPremiumUsd: 0.50,
      rollDownMinPremiumPct: 0.5,
    },
  };
}

/**
 * Round a strike to the nearest multiple of strikeStep.
 */
export function roundStrike(target: number, strikeStep: number): number {
  return Math.round(target / strikeStep) * strikeStep;
}
