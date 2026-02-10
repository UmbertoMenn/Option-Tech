
-- 1. Remove duplicates: keep only the latest row per (user_id, alert_type) where ticker IS NULL
DELETE FROM alert_configs a
USING alert_configs b
WHERE a.user_id = b.user_id
  AND a.alert_type = b.alert_type
  AND a.ticker IS NULL
  AND b.ticker IS NULL
  AND a.id < b.id;

-- 2. Drop old constraint
ALTER TABLE alert_configs
  DROP CONSTRAINT alert_configs_user_id_ticker_alert_type_key;

-- 3. Create new unique index that treats NULLs as equal
CREATE UNIQUE INDEX alert_configs_user_id_ticker_alert_type_key
  ON alert_configs (user_id, COALESCE(ticker, ''), alert_type);
