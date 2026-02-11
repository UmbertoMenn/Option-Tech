export type AssetType = 'bond' | 'stock' | 'etf' | 'derivative' | 'commodity' | 'cash';
export type OptionType = 'call' | 'put';

export interface Position {
  id: string;
  portfolio_id: string;
  isin: string | null;
  ticker: string | null;
  description: string;
  asset_type: AssetType;
  currency: string | null;
  exchange_rate: number | null;
  quantity: number;
  current_price: number | null;
  avg_cost: number | null;
  market_value: number | null;
  profit_loss: number | null;
  profit_loss_pct: number | null;
  weight_pct: number | null;
  option_type: OptionType | null;
  strike_price: number | null;
  expiry_date: string | null;
  underlying: string | null;
  snapshot_price: number | null;
  snapshot_market_value: number | null;
  created_at: string;
  updated_at: string;
}

export interface Portfolio {
  id: string;
  user_id: string;
  name: string;
  total_value: number | null;
  cash_value: number | null;
  last_updated: string | null;
  created_at: string;
  initial_value: number | null;
  initial_date: string | null;
  deposits: number | null;
  average_balance: number | null;
  average_balance_date: string | null;
  snapshot_date: string | null;
}

export interface PortfolioSummary {
  totalValue: number;
  cashValue: number;
  investedValue: number;
  totalProfitLoss: number;
  totalProfitLossPct: number;
  byAssetType: {
    type: AssetType;
    value: number;
    percentage: number;
    profitLoss: number;
  }[];
}

export interface DerivativePosition {
  id: string;
  portfolio_id: string;
  isin: string | null;
  ticker: string | null;
  description: string;
  asset_type: 'derivative';
  currency: string | null;
  quantity: number;
  current_price: number | null;
  avg_cost: number | null;
  market_value: number | null;
  profit_loss: number | null;
  profit_loss_pct: number | null;
  weight_pct: number | null;
  option_type: OptionType;
  strike_price: number;
  expiry_date: string;
  underlying: string;
  created_at: string;
  updated_at: string;
}

export interface OptionPayoffPoint {
  price: number;
  payoff: number;
}

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  bond: 'Obbligazioni',
  stock: 'Azioni',
  etf: 'ETF',
  derivative: 'Derivati',
  commodity: 'Materie Prime',
  cash: 'Liquidità',
};

export const ASSET_TYPE_COLORS: Record<AssetType, string> = {
  bond: 'hsl(217, 91%, 60%)',
  stock: 'hsl(142, 71%, 45%)',
  etf: 'hsl(280, 70%, 60%)',
  derivative: 'hsl(38, 92%, 50%)',
  commodity: 'hsl(25, 95%, 53%)',
  cash: 'hsl(215, 20%, 55%)',
};