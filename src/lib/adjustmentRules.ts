/**
 * Adjustment rules for the backtest engine.
 * Supports preset rules per strategy type and custom rules.
 */

export interface AdjustmentCondition {
  type: 'price_near_barrier' | 'delta_threshold' | 'days_to_expiry' | 'pl_threshold';
  /** For price_near_barrier */
  legType?: 'sold_put' | 'sold_call' | 'bought_put' | 'bought_call';
  distancePct?: number;
  direction?: 'approaching' | 'breached';
  /** For delta_threshold */
  deltaMin?: number;
  deltaMax?: number;
  /** For days_to_expiry */
  maxDays?: number;
  /** For pl_threshold */
  plPct?: number;
}

export interface AdjustmentAction {
  type: 'roll_strike' | 'roll_expiry' | 'close_leg' | 'add_leg' | 'close_all' | 'compound';
  /** For roll_strike */
  rollDistancePct?: number;
  keepSameExpiry?: boolean;
  /** For roll_expiry */
  rollMonths?: number;
  /** For add_leg */
  newLegType?: 'call' | 'put' | 'stock';
  newLegStrikeDistancePct?: number;
  newLegQuantity?: number;
  /** For compound */
  subActions?: AdjustmentAction[];
}

export interface AdjustmentRule {
  id: string;
  name: string;
  condition: AdjustmentCondition;
  action: AdjustmentAction;
  priority: number;
  maxTriggers: number; // 0 = unlimited
  cooldownDays: number;
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
          condition: { type: 'price_near_barrier', legType: 'sold_put', distancePct: 5, direction: 'approaching' },
          action: {
            type: 'compound',
            subActions: [
              { type: 'roll_strike', rollDistancePct: -10, keepSameExpiry: true },
            ],
          },
          priority: 1,
          maxTriggers: 3,
          cooldownDays: 5,
        },
        {
          id: 'ic_defend_call',
          name: 'Difesa call venduta',
          condition: { type: 'price_near_barrier', legType: 'sold_call', distancePct: 5, direction: 'approaching' },
          action: {
            type: 'compound',
            subActions: [
              { type: 'roll_strike', rollDistancePct: 10, keepSameExpiry: true },
            ],
          },
          priority: 2,
          maxTriggers: 3,
          cooldownDays: 5,
        },
        {
          id: 'ic_roll_expiry',
          name: 'Roll a scadenza (5 DTE)',
          condition: { type: 'days_to_expiry', maxDays: 5 },
          action: { type: 'roll_expiry', rollMonths: 1 },
          priority: 3,
          maxTriggers: 0,
          cooldownDays: 0,
        },
        {
          id: 'ic_stop_loss',
          name: 'Stop loss',
          condition: { type: 'pl_threshold', plPct: -50 },
          action: { type: 'close_all' },
          priority: 10,
          maxTriggers: 1,
          cooldownDays: 0,
        },
      ];

    case 'covered_call':
      return [
        {
          id: 'cc_roll_up',
          name: 'Roll up/out',
          condition: { type: 'price_near_barrier', legType: 'sold_call', distancePct: 2, direction: 'breached' },
          action: { type: 'roll_strike', rollDistancePct: 5, keepSameExpiry: false },
          priority: 1,
          maxTriggers: 0,
          cooldownDays: 5,
        },
        {
          id: 'cc_roll_expiry',
          name: 'Roll scadenza (5 DTE)',
          condition: { type: 'days_to_expiry', maxDays: 5 },
          action: { type: 'roll_expiry', rollMonths: 1 },
          priority: 2,
          maxTriggers: 0,
          cooldownDays: 0,
        },
      ];

    case 'cash_secured_put':
      return [
        {
          id: 'csp_roll_down',
          name: 'Roll down/out',
          condition: { type: 'price_near_barrier', legType: 'sold_put', distancePct: 5, direction: 'approaching' },
          action: { type: 'roll_strike', rollDistancePct: -10, keepSameExpiry: false },
          priority: 1,
          maxTriggers: 0,
          cooldownDays: 5,
        },
        {
          id: 'csp_roll_expiry',
          name: 'Roll scadenza (5 DTE)',
          condition: { type: 'days_to_expiry', maxDays: 5 },
          action: { type: 'roll_expiry', rollMonths: 1 },
          priority: 2,
          maxTriggers: 0,
          cooldownDays: 0,
        },
      ];

    case 'double_diagonal':
      return [
        {
          id: 'dd_recenter',
          name: 'Ricentra posizione',
          condition: { type: 'price_near_barrier', legType: 'sold_put', distancePct: 5, direction: 'approaching' },
          action: { type: 'close_all' }, // simplified - would reopen in practice
          priority: 1,
          maxTriggers: 3,
          cooldownDays: 10,
        },
        {
          id: 'dd_stop_loss',
          name: 'Stop loss',
          condition: { type: 'pl_threshold', plPct: -30 },
          action: { type: 'close_all' },
          priority: 10,
          maxTriggers: 1,
          cooldownDays: 0,
        },
      ];

    default:
      return [
        {
          id: 'default_stop_loss',
          name: 'Stop loss',
          condition: { type: 'pl_threshold', plPct: -50 },
          action: { type: 'close_all' },
          priority: 10,
          maxTriggers: 1,
          cooldownDays: 0,
        },
        {
          id: 'default_take_profit',
          name: 'Take profit',
          condition: { type: 'pl_threshold', plPct: 80 },
          action: { type: 'close_all' },
          priority: 11,
          maxTriggers: 1,
          cooldownDays: 0,
        },
      ];
  }
}

/**
 * Human-readable description of a rule.
 */
export function describeRule(rule: AdjustmentRule): string {
  const { condition, action } = rule;
  let condStr = '';
  let actStr = '';

  switch (condition.type) {
    case 'price_near_barrier':
      condStr = `Prezzo ${condition.direction === 'breached' ? 'supera' : 'si avvicina a'} ${condition.legType?.replace('_', ' ')} (${condition.distancePct}%)`;
      break;
    case 'delta_threshold':
      condStr = `Delta tra ${condition.deltaMin ?? '-∞'} e ${condition.deltaMax ?? '+∞'}`;
      break;
    case 'days_to_expiry':
      condStr = `${condition.maxDays} giorni a scadenza`;
      break;
    case 'pl_threshold':
      condStr = `P/L ${(condition.plPct ?? 0) > 0 ? '>' : '<'} ${condition.plPct}%`;
      break;
  }

  switch (action.type) {
    case 'roll_strike':
      actStr = `Rolla strike ${(action.rollDistancePct ?? 0) > 0 ? '+' : ''}${action.rollDistancePct}%`;
      break;
    case 'roll_expiry':
      actStr = `Rolla al mese +${action.rollMonths}`;
      break;
    case 'close_leg':
      actStr = 'Chiudi gamba';
      break;
    case 'close_all':
      actStr = 'Chiudi tutte le posizioni';
      break;
    case 'compound':
      actStr = (action.subActions || []).map(sa => {
        if (sa.type === 'roll_strike') return `Rolla strike ${sa.rollDistancePct}%`;
        if (sa.type === 'roll_expiry') return `Rolla mese +${sa.rollMonths}`;
        return sa.type;
      }).join(' + ');
      break;
    default:
      actStr = action.type;
  }

  return `Se ${condStr} → ${actStr}`;
}
