-- Ogni "call da rivendere" aperta deve avere sempre un avviso attivo.
-- Default: +20% rispetto al premio pagato al riacquisto. La Gestione avvisi
-- può successivamente modificare soglia o modalità (gain_pct / price).

-- La nuova regola riattiva le configurazioni storiche e, in modalità gain,
-- ripristina +20% dove in precedenza era configurata soltanto una perdita.
UPDATE public.call_buyback_alerts
SET enabled = true,
    gain_threshold_pct = CASE
      WHEN alert_mode = 'gain_pct' AND gain_threshold_pct IS NULL THEN 20
      ELSE gain_threshold_pct
    END,
    updated_at = now()
WHERE enabled = false
   OR (alert_mode = 'gain_pct' AND gain_threshold_pct IS NULL);

-- Backfill: le tranche già aperte senza configurazione ricevono +20%.
INSERT INTO public.call_buyback_alerts (
  portfolio_id,
  scope,
  buyback_id,
  underlying,
  strike,
  expiry_date,
  alert_mode,
  gain_threshold_pct,
  loss_threshold_pct,
  price_direction,
  price_target,
  enabled
)
SELECT
  b.portfolio_id,
  'tranche',
  b.id,
  b.underlying,
  b.strike,
  b.expiry_date,
  'gain_pct',
  20,
  NULL,
  NULL,
  NULL,
  true
FROM public.call_buybacks b
WHERE b.quantity > 0
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.ensure_call_buyback_default_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.quantity <= 0 THEN
    DELETE FROM public.call_buyback_alerts
    WHERE scope = 'tranche' AND buyback_id = NEW.id;
    RETURN NEW;
  END IF;

  INSERT INTO public.call_buyback_alerts (
    portfolio_id,
    scope,
    buyback_id,
    underlying,
    strike,
    expiry_date,
    alert_mode,
    gain_threshold_pct,
    loss_threshold_pct,
    price_direction,
    price_target,
    enabled
  ) VALUES (
    NEW.portfolio_id,
    'tranche',
    NEW.id,
    NEW.underlying,
    NEW.strike,
    NEW.expiry_date,
    'gain_pct',
    20,
    NULL,
    NULL,
    NULL,
    true
  )
  ON CONFLICT DO NOTHING;

  -- Se la tranche viene corretta a mano, l'identità mostrata nell'avviso deve
  -- seguire la riga senza sovrascrivere la soglia/modalità scelta dall'utente.
  UPDATE public.call_buyback_alerts
  SET underlying = NEW.underlying,
      strike = NEW.strike,
      expiry_date = NEW.expiry_date,
      enabled = true,
      updated_at = now()
  WHERE scope = 'tranche' AND buyback_id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_call_buyback_default_alert
  ON public.call_buybacks;

CREATE TRIGGER ensure_call_buyback_default_alert
AFTER INSERT OR UPDATE OF quantity, underlying, strike, expiry_date
ON public.call_buybacks
FOR EACH ROW
EXECUTE FUNCTION public.ensure_call_buyback_default_alert();

-- In modalità gain la soglia positiva è sempre presente; in modalità prezzo
-- resta valida la precedente alternativa esclusiva richiesta per singola call.
ALTER TABLE public.call_buyback_alerts
  DROP CONSTRAINT IF EXISTS call_buyback_alerts_mode_values;

ALTER TABLE public.call_buyback_alerts
  ADD CONSTRAINT call_buyback_alerts_mode_values
  CHECK (
    (
      alert_mode = 'gain_pct'
      AND gain_threshold_pct IS NOT NULL
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

-- Un avviso esistente non può essere spento: si modifica il parametro oppure
-- si passa alla modalità prezzo, ma la call resta sempre monitorata.
ALTER TABLE public.call_buyback_alerts
  DROP CONSTRAINT IF EXISTS call_buyback_alerts_always_enabled;

ALTER TABLE public.call_buyback_alerts
  ADD CONSTRAINT call_buyback_alerts_always_enabled
  CHECK (enabled = true);
