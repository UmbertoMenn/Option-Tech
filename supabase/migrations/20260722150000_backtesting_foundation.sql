CREATE TABLE IF NOT EXISTS public.backtest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  portfolio_id uuid REFERENCES public.portfolios(id) ON DELETE SET NULL,
  name text NOT NULL,
  strategy_id text NOT NULL,
  symbol text NOT NULL,
  data_provider text NOT NULL DEFAULT 'thetadata',
  data_granularity text NOT NULL DEFAULT 'eod',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'queued', 'running', 'completed', 'failed', 'cancelled')),
  summary jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS backtest_runs_user_created_idx
  ON public.backtest_runs (user_id, created_at DESC);

ALTER TABLE public.backtest_runs ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_backtest_runs_updated_at
  BEFORE UPDATE ON public.backtest_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Users can read own backtest runs"
  ON public.backtest_runs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own backtest runs"
  ON public.backtest_runs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own backtest runs"
  ON public.backtest_runs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own backtest runs"
  ON public.backtest_runs FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all backtest runs"
  ON public.backtest_runs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

COMMENT ON TABLE public.backtest_runs IS
  'Stores backtest configuration and aggregate results only. Raw ThetaData market data is not persisted here.';
