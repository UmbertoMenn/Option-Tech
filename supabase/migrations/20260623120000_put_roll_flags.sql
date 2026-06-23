-- "PUT da rollare al rialzo" flags.
--
-- Marks specific Naked Put strategies (by stable strategy_key, np_{underlying}_{strike}_{YYYYMM})
-- as "roll up" candidates. When a put is flagged, the check-alerts engine fires the dedicated
-- roll-up alerts (ITM + avvicinamento) for it and SUPPRESSES the standard naked-put alerts.
--
-- Keyed by strategy_key (not position UUID) so the flag survives both a strategy_cache rebuild
-- and a fresh snapshot re-import.

CREATE TABLE public.put_roll_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  strategy_key TEXT NOT NULL,
  roll_up BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(portfolio_id, strategy_key)
);

ALTER TABLE public.put_roll_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all put_roll_flags"
  ON public.put_roll_flags
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can read own put roll flags"
  ON public.put_roll_flags
  FOR SELECT
  USING (portfolio_id IN (
    SELECT id FROM public.portfolios WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can insert own put roll flags"
  ON public.put_roll_flags
  FOR INSERT
  WITH CHECK (portfolio_id IN (
    SELECT id FROM public.portfolios WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can update own put roll flags"
  ON public.put_roll_flags
  FOR UPDATE
  USING (portfolio_id IN (
    SELECT id FROM public.portfolios WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can delete own put roll flags"
  ON public.put_roll_flags
  FOR DELETE
  USING (portfolio_id IN (
    SELECT id FROM public.portfolios WHERE user_id = auth.uid()
  ));

CREATE INDEX idx_put_roll_flags_portfolio ON public.put_roll_flags(portfolio_id);
