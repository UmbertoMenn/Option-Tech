-- Ogni riga "call da rivendere" espone un solo avviso configurabile:
-- G/P percentuale sul premio oppure prezzo del sottostante.
--
-- I record esistenti restano in modalità gain_pct. Le colonne prezzo vivono
-- nella stessa tabella per garantire l'esclusività a livello database e
-- continuano a decadere insieme alla tranche tramite buyback_id ON DELETE
-- CASCADE.

ALTER TABLE public.call_buyback_alerts
  ADD COLUMN IF NOT EXISTS alert_mode TEXT NOT NULL DEFAULT 'gain_pct',
  ADD COLUMN IF NOT EXISTS price_direction TEXT,
  ADD COLUMN IF NOT EXISTS price_target NUMERIC;

ALTER TABLE public.call_buyback_alerts
  DROP CONSTRAINT IF EXISTS call_buyback_alerts_has_threshold,
  DROP CONSTRAINT IF EXISTS call_buyback_alerts_alert_mode_check,
  DROP CONSTRAINT IF EXISTS call_buyback_alerts_mode_values;

ALTER TABLE public.call_buyback_alerts
  ADD CONSTRAINT call_buyback_alerts_alert_mode_check
    CHECK (alert_mode IN ('gain_pct', 'price')),
  ADD CONSTRAINT call_buyback_alerts_mode_values
    CHECK (
      (
        alert_mode = 'gain_pct'
        AND (gain_threshold_pct IS NOT NULL OR loss_threshold_pct IS NOT NULL)
        AND price_direction IS NULL
        AND price_target IS NULL
      )
      OR
      (
        alert_mode = 'price'
        AND gain_threshold_pct IS NULL
        AND loss_threshold_pct IS NULL
        AND price_direction IN ('above', 'below')
        AND price_target IS NOT NULL
        AND price_target > 0
      )
    );

COMMENT ON COLUMN public.call_buyback_alerts.alert_mode IS
  'Modalità esclusiva: gain_pct sul premio oppure price sul sottostante.';
COMMENT ON COLUMN public.call_buyback_alerts.price_direction IS
  'Direzione della soglia prezzo: above o below; valorizzata solo in modalità price.';
COMMENT ON COLUMN public.call_buyback_alerts.price_target IS
  'Prezzo target positivo del sottostante; valorizzato solo in modalità price.';
