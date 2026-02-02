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
  created_at: string;
  updated_at: string;
}

export interface HistoricalDataInput {
  snapshot_date: string;
  total_value: number;
  netting_total: number;
  netting_ex_cc: number;
  netting_ex_cc_np: number;
  deposits: number;
  average_balance: number;
}
