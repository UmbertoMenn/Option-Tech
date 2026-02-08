export interface HistoricalDataEntry {
  id: string;
  portfolio_id: string;
  snapshot_date: string;
  total_value: number;
  netting_total: number;
  netting_ex_cc: number;
  netting_ex_cc_np: number;
  deposits: number;
  average_balance: number;
  equity_exposure_pct: number; // 0-1, default 0.6
  usd_exposure_pct: number;    // 0-1, default 0.8
  created_at: string;
  updated_at: string;
}

export interface HistoricalDataInput {
  id?: string; // Optional: used for updates
  snapshot_date: string;
  total_value: number;
  netting_total: number;
  netting_ex_cc: number;
  netting_ex_cc_np: number;
  deposits: number;
  average_balance: number;
  equity_exposure_pct: number; // 0-1
  usd_exposure_pct: number;    // 0-1
}
