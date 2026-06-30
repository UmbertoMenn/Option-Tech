CREATE TABLE public.put_roll_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  strategy_key TEXT NOT NULL,
  target NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, portfolio_id, strategy_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.put_roll_targets TO authenticated;
GRANT ALL ON public.put_roll_targets TO service_role;

ALTER TABLE public.put_roll_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own put roll targets"
  ON public.put_roll_targets FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_put_roll_targets_user_portfolio
  ON public.put_roll_targets(user_id, portfolio_id);