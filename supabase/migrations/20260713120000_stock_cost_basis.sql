-- Prezzi medi di carico (PMC) persistenti.
--
-- I flussi CSV della banca non includono più il PMC nel FlussoSaldiContiTitoli.
-- Il PMC viene quindi:
--   1. caricato la prima volta dal vecchio file Excel tramite il wizard in
--      Dashboard (fonte 'excel'); ricaricabile in ogni momento per riallineare;
--   2. mantenuto aggiornato ad ogni upload dei movimenti titoli (fonte
--      'movements') con la regola della media ponderata continua: gli acquisti
--      ricalcolano la media, le vendite riducono solo la quantità.
--
-- stock_cost_basis: una riga per (portafoglio, titolo). basis_key = ISIN se
-- disponibile, altrimenti chiave canonica del ticker. Sopravvive al ciclo
-- delete+insert delle positions ad ogni upload.
--
-- cost_basis_trades: ledger di idempotenza dei movimenti già applicati al PMC.
-- Ricaricare lo stesso file movimenti non riapplica nulla (chiave naturale
-- univoca). kind = 'trade' per operazioni normali, 'assignment_close' per
-- vendite che chiudono un lotto assegnato (assegnazione anticipata di put):
-- queste NON toccano quantità né PMC del titolo preesistente.

CREATE TABLE IF NOT EXISTS public.stock_cost_basis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  basis_key text NOT NULL,
  isin text,
  description text,
  pmc numeric NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  currency text,
  source text NOT NULL DEFAULT 'excel',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, basis_key)
);

CREATE TABLE IF NOT EXISTS public.cost_basis_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  basis_key text NOT NULL,
  trade_date date NOT NULL,
  side text NOT NULL,
  quantity numeric NOT NULL,
  price numeric NOT NULL,
  kind text NOT NULL DEFAULT 'trade',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, basis_key, trade_date, side, quantity, price)
);

ALTER TABLE public.stock_cost_basis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_basis_trades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage cost basis of own portfolios" ON public.stock_cost_basis;
CREATE POLICY "Users can manage cost basis of own portfolios"
ON public.stock_cost_basis
FOR ALL
USING (EXISTS (SELECT 1 FROM public.portfolios p WHERE p.id = portfolio_id AND p.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.portfolios p WHERE p.id = portfolio_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage all cost basis" ON public.stock_cost_basis;
CREATE POLICY "Admins can manage all cost basis"
ON public.stock_cost_basis
FOR ALL
USING (private.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can manage cost basis trades of own portfolios" ON public.cost_basis_trades;
CREATE POLICY "Users can manage cost basis trades of own portfolios"
ON public.cost_basis_trades
FOR ALL
USING (EXISTS (SELECT 1 FROM public.portfolios p WHERE p.id = portfolio_id AND p.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.portfolios p WHERE p.id = portfolio_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage all cost basis trades" ON public.cost_basis_trades;
CREATE POLICY "Admins can manage all cost basis trades"
ON public.cost_basis_trades
FOR ALL
USING (private.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
