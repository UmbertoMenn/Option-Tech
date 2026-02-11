
-- Add snapshot columns to preserve Excel values
ALTER TABLE public.positions 
ADD COLUMN snapshot_price numeric,
ADD COLUMN snapshot_market_value numeric;

-- Backfill existing positions (best-effort: current values may already be cron-updated)
UPDATE public.positions 
SET snapshot_price = current_price, 
    snapshot_market_value = market_value
WHERE snapshot_price IS NULL;
