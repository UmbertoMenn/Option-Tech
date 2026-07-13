ALTER TABLE public.strategy_configurations
  ADD COLUMN IF NOT EXISTS config_locked boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS override_canceled_at timestamptz;