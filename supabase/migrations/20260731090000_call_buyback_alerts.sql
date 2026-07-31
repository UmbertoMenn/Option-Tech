-- Avvisi sulle "call da rivendere".
--
-- Due meccaniche distinte, entrambe impostate dalla card della singola call:
--
-- 1) SOGLIA SUL G/P POTENZIALE (%) sul premio pagato al riacquisto.
--    Configurabile a due livelli, con avviso separato:
--      - scope='tranche' → il singolo lotto (buyback_id valorizzato), col suo
--        prezzo di riacquisto;
--      - scope='call'    → tutte le tranche aperte della stessa call
--        (underlying+strike+scadenza), sulla MEDIA PONDERATA per quantità dei
--        prezzi di riacquisto.
--    Le due direzioni sono indipendenti: gain_threshold_pct scatta quando il
--    G/P% sale sopra +X, loss_threshold_pct quando scende sotto −Y. Entrambe
--    sono magnitudini POSITIVE; NULL = direzione non monitorata.
--
-- 2) AVVISO DI PREZZO SUL SOTTOSTANTE: resta un price_alerts normale, cambia
--    solo il titolo dell'avviso generato. Vedi la colonna context in fondo.
--
-- Scope PORTAFOGLIO e non utente: il consulente opera su portafogli altrui e
-- la stessa call può esistere su più clienti; una config per utente
-- produrrebbe un solo avviso per tutti.

CREATE TABLE IF NOT EXISTS public.call_buyback_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('tranche', 'call')),
  -- Valorizzato SOLO per scope='tranche': se la tranche sparisce (rivenduta o
  -- cancellata) l'avviso decade con lei.
  buyback_id UUID REFERENCES public.call_buybacks(id) ON DELETE CASCADE,
  -- Identità della call, sempre valorizzata: per scope='call' è la chiave di
  -- aggregazione, per scope='tranche' serve a comporre il messaggio.
  underlying TEXT NOT NULL,
  strike NUMERIC NOT NULL,
  expiry_date DATE NOT NULL,
  gain_threshold_pct NUMERIC CHECK (gain_threshold_pct IS NULL OR gain_threshold_pct > 0),
  loss_threshold_pct NUMERIC CHECK (loss_threshold_pct IS NULL OR loss_threshold_pct > 0),
  enabled BOOLEAN NOT NULL DEFAULT true,
  cooldown_minutes INTEGER NOT NULL DEFAULT 480,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  -- Una config vuota non ha senso: almeno una direzione dev'essere impostata.
  CONSTRAINT call_buyback_alerts_has_threshold
    CHECK (gain_threshold_pct IS NOT NULL OR loss_threshold_pct IS NOT NULL),
  -- Coerenza scope ↔ buyback_id.
  CONSTRAINT call_buyback_alerts_scope_shape
    CHECK ((scope = 'tranche' AND buyback_id IS NOT NULL)
        OR (scope = 'call' AND buyback_id IS NULL))
);

-- Una sola config per tranche…
CREATE UNIQUE INDEX IF NOT EXISTS call_buyback_alerts_tranche_key
  ON public.call_buyback_alerts (buyback_id)
  WHERE scope = 'tranche';

-- …e una sola per call aggregata.
CREATE UNIQUE INDEX IF NOT EXISTS call_buyback_alerts_call_key
  ON public.call_buyback_alerts (portfolio_id, underlying, strike, expiry_date)
  WHERE scope = 'call';

CREATE INDEX IF NOT EXISTS idx_call_buyback_alerts_portfolio
  ON public.call_buyback_alerts (portfolio_id, enabled);

ALTER TABLE public.call_buyback_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own call buyback alerts" ON public.call_buyback_alerts;
CREATE POLICY "Users can manage their own call buyback alerts"
ON public.call_buyback_alerts
FOR ALL
USING (portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid()))
WITH CHECK (portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid()));

-- Il consulente opera su portafogli che non possiede: senza questa policy ogni
-- inserimento fallirebbe con "new row violates row-level security policy".
DROP POLICY IF EXISTS "Admins can manage all call buyback alerts" ON public.call_buyback_alerts;
CREATE POLICY "Admins can manage all call buyback alerts"
ON public.call_buyback_alerts
FOR ALL
USING (private.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Service role manages call buyback alerts" ON public.call_buyback_alerts;
CREATE POLICY "Service role manages call buyback alerts"
ON public.call_buyback_alerts
FOR ALL
USING (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS update_call_buyback_alerts_updated_at ON public.call_buyback_alerts;
CREATE TRIGGER update_call_buyback_alerts_updated_at
BEFORE UPDATE ON public.call_buyback_alerts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Contesto dell'avviso di prezzo: 'generic' = avviso prezzo classico,
-- 'call_buyback' = stessa identica logica di trigger, ma il titolo generato
-- diventa esplicito ("Call da rivendere") per quel ticker.
ALTER TABLE public.price_alerts
  ADD COLUMN IF NOT EXISTS context TEXT NOT NULL DEFAULT 'generic';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'price_alerts_context_check'
  ) THEN
    ALTER TABLE public.price_alerts
      ADD CONSTRAINT price_alerts_context_check
      CHECK (context IN ('generic', 'call_buyback'));
  END IF;
END $$;

-- Il vincolo univoco di price_alerts non conosceva il contesto: un avviso
-- "call da rivendere" sullo stesso ticker/direzione/prezzo di uno generico
-- veniva rifiutato come duplicato. Il contesto entra nella chiave.
ALTER TABLE public.price_alerts
  DROP CONSTRAINT IF EXISTS price_alerts_user_id_ticker_direction_target_price_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'price_alerts_user_ticker_dir_price_context_key'
  ) THEN
    ALTER TABLE public.price_alerts
      ADD CONSTRAINT price_alerts_user_ticker_dir_price_context_key
      UNIQUE (user_id, ticker, direction, target_price, context);
  END IF;
END $$;

-- alert_type è un ENUM Postgres: senza questi due valori l'insert dell'avviso
-- da parte di check-alerts fallirebbe a runtime.
ALTER TYPE public.alert_type ADD VALUE IF NOT EXISTS 'action_call_buyback_gain';
ALTER TYPE public.alert_type ADD VALUE IF NOT EXISTS 'action_call_buyback_loss';
