CREATE TABLE public.put_roll_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  strategy_key TEXT NOT NULL,
  roll_up BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(portfolio_id, strategy_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.put_roll_flags TO authenticated;
GRANT ALL ON public.put_roll_flags TO service_role;

ALTER TABLE public.put_roll_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own put roll flags"
  ON public.put_roll_flags
  FOR SELECT
  USING (portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own put roll flags"
  ON public.put_roll_flags
  FOR INSERT
  WITH CHECK (portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own put roll flags"
  ON public.put_roll_flags
  FOR UPDATE
  USING (portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own put roll flags"
  ON public.put_roll_flags
  FOR DELETE
  USING (portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid()));

CREATE INDEX idx_put_roll_flags_portfolio ON public.put_roll_flags(portfolio_id);

CREATE TRIGGER update_put_roll_flags_updated_at
  BEFORE UPDATE ON public.put_roll_flags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();