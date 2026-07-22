export type BacktestStrategyId =
  | 'covered_call'
  | 'synthetic_covered_call'
  | 'de_risking_covered_call'
  | 'cash_secured_put'
  | 'wheel'
  | 'bull_put_spread'
  | 'bear_call_spread'
  | 'iron_condor'
  | 'protective_put'
  | 'collar'
  | 'calendar_spread'
  | 'diagonal_spread'
  | 'double_diagonal';

export type StrategyPhase = 1 | 2 | 3;
export type BacktestBarSize = 'eod' | '1m';
export type EntryFrequency = 'once' | 'weekly' | 'monthly' | 'after_expiry';
export type StrikeSelectionMode = 'delta' | 'otm_pct';
export type FillPriceModel = 'natural' | 'mid' | 'mid_with_slippage';

export interface StrategyLegTemplate {
  role: string;
  description: string;
  required: boolean;
  canBeTemporarilyMissing?: boolean;
}

export interface StrategyDefinition {
  id: BacktestStrategyId;
  name: string;
  shortName: string;
  phase: StrategyPhase;
  description: string;
  status: 'foundation' | 'planned';
  legs: StrategyLegTemplate[];
  entryRules: string[];
  managementRules: string[];
  exitRules: string[];
}

export interface BacktestConfig {
  strategyId: BacktestStrategyId;
  symbol: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  contracts: number;
  barSize: BacktestBarSize;
  entry: {
    frequency: EntryFrequency;
    selectionMode: StrikeSelectionMode;
    targetDelta: number;
    targetOtmPct: number;
    minDte: number;
    maxDte: number;
    minOpenInterest: number;
    minVolume: number;
    maxBidAskSpreadPct: number;
    minPremiumPct: number;
  };
  management: {
    takeProfitPct: number;
    stopLossMultiple: number | null;
    rollAtDte: number;
    rollAtDelta: number;
    rollAtStrikeDistancePct: number;
    requireNetCredit: boolean;
    closeBeforeExpiry: boolean;
  };
  execution: {
    fillPriceModel: FillPriceModel;
    slippagePctOfSpread: number;
    commissionPerContract: number;
    commissionPerShare: number;
  };
  risk: {
    maxCapitalPerTradePct: number;
    maxConcurrentPositions: number;
    allowNakedOptions: boolean;
  };
}

export interface BacktestValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export type ThetaDataOperation =
  | 'health'
  | 'stock-eod'
  | 'option-contracts'
  | 'option-eod'
  | 'option-quotes'
  | 'option-eod-greeks';

export interface ThetaDataRequest {
  operation: ThetaDataOperation;
  symbol?: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  expiration?: string;
  strike?: number | '*';
  right?: 'call' | 'put' | 'both';
  interval?: '1m' | '5m' | '15m' | '30m' | '1h';
  maxDte?: number;
  strikeRange?: number;
}

export interface ThetaDataHealth {
  connected: boolean;
  provider: 'thetadata';
  apiVersion: 'v3';
  baseUrlConfigured: boolean;
  schedule?: unknown;
  message?: string;
}
