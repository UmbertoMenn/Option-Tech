
-- Rimuovere il vecchio indice con COALESCE
DROP INDEX IF EXISTS alert_configs_user_id_ticker_alert_type_key;

-- Creare il nuovo indice univoco che tratta NULL come uguale
CREATE UNIQUE INDEX alert_configs_user_ticker_type_uq
  ON alert_configs (user_id, ticker, alert_type)
  NULLS NOT DISTINCT;
