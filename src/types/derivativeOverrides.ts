export type OverrideCategory = 
  | 'covered_call' 
  | 'protection' 
  | 'naked_put' 
  | 'leap_call' 
  | 'other';

export type MultiLegStrategyType = 'iron_condor' | 'double_diagonal';

export interface DerivativeOverride {
  id: string;
  portfolio_id: string;
  override_type: 'single' | 'multi_leg';
  
  // For single overrides
  position_id: string | null;
  target_category: OverrideCategory | null;
  linked_stock_id: string | null;
  
  // For multi-leg strategies
  strategy_type: MultiLegStrategyType | null;
  sold_put_id: string | null;
  bought_put_id: string | null;
  sold_call_id: string | null;
  bought_call_id: string | null;
  
  created_at: string;
  updated_at: string;
}

export interface AvailableStock {
  positionId: string;
  description: string;
  ticker: string | null;
  underlying: string;
  totalShares: number;
  usedShares: number;
  availableShares: number;
  availableContracts: number;
}

export interface CreateSingleOverrideParams {
  positionId: string;
  targetCategory: OverrideCategory;
  linkedStockId?: string;
}

export interface CreateMultiLegOverrideParams {
  strategyType: MultiLegStrategyType;
  soldPutId: string;
  boughtPutId: string;
  soldCallId: string;
  boughtCallId: string;
}
