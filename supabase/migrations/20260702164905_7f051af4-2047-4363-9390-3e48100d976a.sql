ALTER TABLE public.historical_data
  ADD COLUMN IF NOT EXISTS netting_intrinsic_b numeric;

ALTER TABLE public.portfolio_latest_values
  ADD COLUMN IF NOT EXISTS netting_intrinsic_b numeric;