
-- Create staging table for frontend-calculated values
CREATE TABLE public.portfolio_latest_values (
  portfolio_id uuid NOT NULL PRIMARY KEY REFERENCES public.portfolios(id) ON DELETE CASCADE,
  total_value numeric NOT NULL DEFAULT 0,
  netting_total numeric NOT NULL DEFAULT 0,
  netting_ex_cc_np numeric NOT NULL DEFAULT 0,
  equity_exposure_pct numeric NOT NULL DEFAULT 0.6,
  usd_exposure_pct numeric NOT NULL DEFAULT 0.8,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.portfolio_latest_values ENABLE ROW LEVEL SECURITY;

-- Users can upsert their own values
CREATE POLICY "Users can upsert own latest values"
ON public.portfolio_latest_values
FOR ALL
USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()))
WITH CHECK (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

-- Admins can manage all
CREATE POLICY "Admins can manage all latest values"
ON public.portfolio_latest_values
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Service role can read all (for cron job)
CREATE POLICY "Service role can read all latest values"
ON public.portfolio_latest_values
FOR SELECT
USING (auth.role() = 'service_role'::text);
