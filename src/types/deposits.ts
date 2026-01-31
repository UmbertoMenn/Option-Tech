export interface DepositEntry {
  id: string;
  portfolio_id: string;
  deposit_date: string;
  amount: number;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface DepositInput {
  id?: string;
  deposit_date: string;
  amount: number;
  description?: string;
}
