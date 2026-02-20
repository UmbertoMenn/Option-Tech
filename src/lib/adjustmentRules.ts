/**
 * Simplified adjustment rules for the backtest engine.
 * Only supports price_near_barrier condition with roll actions.
 */

export interface AdjustmentCondition {
  type: 'price_near_barrier';
  legType: 'sold_put' | 'sold_call';
  /** Activation distance: triggers when price is within this % of the strike */
  distancePct: number;
}

export interface AdjustmentAction {
  type: 'roll_strike' | 'roll_expiry' | 'roll_both';
  /** New barrier % from current price for the rolled strike */
  newBarrierPct: number;
  /** Months ahead for expiry roll (used by roll_expiry and roll_both) */
  rollMonths: number;
}

export interface AdjustmentRule {
  id: string;
  name: string;
  condition: AdjustmentCondition;
  action: AdjustmentAction;
  /** Strike increment grid (default 5). New strike is rounded to nearest multiple. */
  strikeStep: number;
  priority: number;
}

export type StrategyPresetType =
  | 'iron_condor'
  | 'covered_call'
  | 'cash_secured_put'
  | 'double_diagonal'
  | 'bull_call_spread'
  | 'bear_put_spread'
  | 'straddle'
  | 'strangle';

/**
 * Get preset adjustment rules for a strategy type.
 */
export function getPresetRules(strategyType: StrategyPresetType): AdjustmentRule[] {
  switch (strategyType) {
    case 'iron_condor':
      return [
        {
          id: 'ic_defend_put',
          name: 'Difesa put venduta',
          condition: { type: 'price_near_barrier', legType: 'sold_put', distancePct: 5 },
          action: { type: 'roll_strike', newBarrierPct: 10, rollMonths: 1 },
          strikeStep: 5,
          priority: 1,
        },
        {
          id: 'ic_defend_call',
          name: 'Difesa call venduta',
          condition: { type: 'price_near_barrier', legType: 'sold_call', distancePct: 5 },
          action: { type: 'roll_strike', newBarrierPct: 10, rollMonths: 1 },
          strikeStep: 5,
          priority: 2,
        },
      ];

    case 'covered_call':
      return [
        {
          id: 'cc_roll',
          name: 'Roll call venduta',
          condition: { type: 'price_near_barrier', legType: 'sold_call', distancePct: 2 },
          action: { type: 'roll_both', newBarrierPct: 5, rollMonths: 1 },
          strikeStep: 5,
          priority: 1,
        },
      ];

    case 'cash_secured_put':
      return [
        {
          id: 'csp_roll',
          name: 'Roll put venduta',
          condition: { type: 'price_near_barrier', legType: 'sold_put', distancePct: 5 },
          action: { type: 'roll_both', newBarrierPct: 10, rollMonths: 1 },
          strikeStep: 5,
          priority: 1,
        },
      ];

    case 'double_diagonal':
      return [
        {
          id: 'dd_defend_put',
          name: 'Difesa put venduta',
          condition: { type: 'price_near_barrier', legType: 'sold_put', distancePct: 5 },
          action: { type: 'roll_both', newBarrierPct: 10, rollMonths: 1 },
          strikeStep: 5,
          priority: 1,
        },
        {
          id: 'dd_defend_call',
          name: 'Difesa call venduta',
          condition: { type: 'price_near_barrier', legType: 'sold_call', distancePct: 5 },
          action: { type: 'roll_both', newBarrierPct: 10, rollMonths: 1 },
          strikeStep: 5,
          priority: 2,
        },
      ];

    default:
      return [
        {
          id: 'default_defend_put',
          name: 'Difesa put venduta',
          condition: { type: 'price_near_barrier', legType: 'sold_put', distancePct: 5 },
          action: { type: 'roll_strike', newBarrierPct: 10, rollMonths: 1 },
          strikeStep: 5,
          priority: 1,
        },
      ];
  }
}

/**
 * Round a strike to the nearest multiple of strikeStep.
 */
export function roundStrike(target: number, strikeStep: number): number {
  return Math.round(target / strikeStep) * strikeStep;
}

/**
 * Human-readable description of a rule.
 */
export function describeRule(rule: AdjustmentRule): string {
  const { condition, action } = rule;
  const legLabel = condition.legType === 'sold_put' ? 'put venduta' : 'call venduta';
  const condStr = `Prezzo entro ${condition.distancePct}% della ${legLabel}`;

  let actStr = '';
  switch (action.type) {
    case 'roll_strike':
      actStr = `Rolla strike a ${action.newBarrierPct}% dal prezzo (step ${rule.strikeStep})`;
      break;
    case 'roll_expiry':
      actStr = `Rolla scadenza +${action.rollMonths} mesi`;
      break;
    case 'roll_both':
      actStr = `Rolla strike a ${action.newBarrierPct}% + scadenza +${action.rollMonths} mesi (step ${rule.strikeStep})`;
      break;
  }

  return `Se ${condStr} → ${actStr}`;
}
