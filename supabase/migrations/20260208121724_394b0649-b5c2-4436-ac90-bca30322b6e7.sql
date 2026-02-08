-- Add option details columns to alerts table
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS option_type text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS option_expiry date;

-- Add expiry dates to strategy_cache table
ALTER TABLE strategy_cache ADD COLUMN IF NOT EXISTS sold_call_expiry date;
ALTER TABLE strategy_cache ADD COLUMN IF NOT EXISTS sold_put_expiry date;