-- Ledger dei movimenti banca (FlussoMovContiCash / FlussoMovContiTit)
-- caricati dalla card "Scomposizione Rendimento": ricostruisce flussi per
-- classe, commissioni, ritenute, bolli e imposta capital gain.

CREATE TABLE IF NOT EXISTS public.portfolio_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  row_key text NOT NULL,
  source text NOT NULL CHECK (source IN ('cash', 'titoli')),
  account_id text NOT NULL,
  scope text NOT NULL DEFAULT 'portfolio' CHECK (scope IN ('portfolio', 'gp')),
  kind text NOT NULL,
  effective_date date NOT NULL,
  booking_date date,
  value_date date,
  operation_date date,
  causale text,
  causale_description text,
  operation_id text,
  description text,
  isin text,
  descriptor text,
  underlying_ticker text,
  option_type text,
  strike numeric,
  expiry_date date,
  position_side text,
  quantity numeric,
  price numeric,
  currency text,
  exchange_rate numeric,
  gross_eur numeric NOT NULL DEFAULT 0,
  accrued_eur numeric NOT NULL DEFAULT 0,
  net_eur numeric NOT NULL DEFAULT 0,
  commission_eur numeric NOT NULL DEFAULT 0,
  fx_commission_eur numeric NOT NULL DEFAULT 0,
  tax_eur numeric NOT NULL DEFAULT 0,
  bolli_eur numeric NOT NULL DEFAULT 0,
  unexplained_charge_eur numeric NOT NULL DEFAULT 0,
  period_start date,
  period_end date,
  underlying_key text,
  underlying_price numeric,
  intrinsic_per_share numeric,
  time_value_per_share numeric,
  attribution_price_source text,
  -- Premio temporale per azione corretto a mano (vendite ITM senza roll/assegnazione
  -- di riferimento). Mai toccato dal ricaricamento dei file.
  manual_time_value_per_share numeric CHECK (manual_time_value_per_share IS NULL OR manual_time_value_per_share >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, row_key)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_movements_period
  ON public.portfolio_movements (portfolio_id, effective_date);

ALTER TABLE public.portfolio_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own portfolio movements" ON public.portfolio_movements;
CREATE POLICY "Users can manage own portfolio movements"
  ON public.portfolio_movements FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.portfolios p WHERE p.id = portfolio_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.portfolios p WHERE p.id = portfolio_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage all portfolio movements" ON public.portfolio_movements;
CREATE POLICY "Admins can manage all portfolio movements"
  ON public.portfolio_movements FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.portfolio_movement_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('cash', 'titoli')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  file_name text,
  rows_total integer NOT NULL DEFAULT 0,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, source, period_start, period_end)
);

ALTER TABLE public.portfolio_movement_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own movement uploads" ON public.portfolio_movement_uploads;
CREATE POLICY "Users can manage own movement uploads"
  ON public.portfolio_movement_uploads FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.portfolios p WHERE p.id = portfolio_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.portfolios p WHERE p.id = portfolio_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage all movement uploads" ON public.portfolio_movement_uploads;
CREATE POLICY "Admins can manage all movement uploads"
  ON public.portfolio_movement_uploads FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
