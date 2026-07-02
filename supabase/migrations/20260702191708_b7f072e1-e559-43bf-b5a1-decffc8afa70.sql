CREATE TABLE public.portfolio_full_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  positions JSONB NOT NULL DEFAULT '[]'::jsonb,
  strategy_configurations JSONB NOT NULL DEFAULT '[]'::jsonb,
  derivative_overrides JSONB NOT NULL DEFAULT '[]'::jsonb,
  gp_holdings JSONB NOT NULL DEFAULT '[]'::jsonb,
  cash_value NUMERIC NOT NULL DEFAULT 0,
  gp_total_value NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(portfolio_id, snapshot_date)
);

GRANT ALL ON public.portfolio_full_snapshots TO authenticated;
GRANT ALL ON public.portfolio_full_snapshots TO service_role;

ALTER TABLE public.portfolio_full_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all portfolio_full_snapshots"
  ON public.portfolio_full_snapshots FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can read own full snapshots"
  ON public.portfolio_full_snapshots FOR SELECT
  USING (portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own full snapshots"
  ON public.portfolio_full_snapshots FOR INSERT
  WITH CHECK (portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own full snapshots"
  ON public.portfolio_full_snapshots FOR UPDATE
  USING (portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own full snapshots"
  ON public.portfolio_full_snapshots FOR DELETE
  USING (portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid()));

CREATE INDEX idx_portfolio_full_snapshots_pid_date
  ON public.portfolio_full_snapshots(portfolio_id, snapshot_date DESC);