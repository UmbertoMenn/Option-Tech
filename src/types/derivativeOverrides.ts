export type OverrideCategory = 'covered_call' | 'protection' | 'naked_put' | 'leap_call' | 'other';
export type OverrideStrategyType = 'iron_condor' | 'double_diagonal';
export type OverrideType = 'single' | 'multi_leg';

export interface DerivativeOverride {
  id: string;
  portfolio_id: string;
  override_type: OverrideType;
  
  // For single overrides
  position_id?: string;
  target_category?: OverrideCategory;
  linked_stock_id?: string;
  
  // For multi-leg overrides
  strategy_type?: OverrideStrategyType;
  sold_put_id?: string;
  bought_put_id?: string;
  sold_call_id?: string;
  bought_call_id?: string;
  
  created_at: string;
  updated_at: string;
}

export const OVERRIDE_CATEGORY_LABELS: Record<OverrideCategory, string> = {
  covered_call: 'Covered Call',
  protection: 'Protezione',
  naked_put: 'Naked Put',
  leap_call: 'Leap Call',
  other: 'Altre Strategie',
};
