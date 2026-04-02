
-- 1. Create gp_holdings table
CREATE TABLE public.gp_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  asset_type text NOT NULL,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  market_value numeric NOT NULL DEFAULT 0,
  price numeric,
  currency text DEFAULT 'EUR',
  exchange_rate numeric DEFAULT 1,
  weight_pct numeric,
  ticker_code text,
  price_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.gp_holdings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all gp_holdings"
  ON public.gp_holdings FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view own gp_holdings"
  ON public.gp_holdings FOR SELECT
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own gp_holdings"
  ON public.gp_holdings FOR INSERT
  WITH CHECK (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own gp_holdings"
  ON public.gp_holdings FOR UPDATE
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own gp_holdings"
  ON public.gp_holdings FOR DELETE
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

CREATE TRIGGER update_gp_holdings_updated_at
  BEFORE UPDATE ON public.gp_holdings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Add GP columns to portfolios
ALTER TABLE public.portfolios
  ADD COLUMN gp_total_value numeric DEFAULT 0,
  ADD COLUMN gp_cash_value numeric DEFAULT 0;
