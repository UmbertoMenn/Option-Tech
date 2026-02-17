
CREATE TABLE public.dismissed_unresolved_tickers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  underlying TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, portfolio_id, underlying)
);

ALTER TABLE public.dismissed_unresolved_tickers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own dismissed tickers"
  ON public.dismissed_unresolved_tickers
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
