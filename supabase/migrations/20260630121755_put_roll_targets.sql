-- "Target da recuperare" per le PUT vendute ITM da rollare al rialzo.
--
-- A differenza di put_roll_flags (che è per-portfolio, condiviso fra l'owner del
-- portfolio e l'admin), questo valore è PRIVATO PER UTENTE: ogni utente (incluso
-- l'admin) vede e modifica SOLO il proprio target. Due utenti diversi che guardano
-- la stessa PUT hanno target indipendenti.
--
-- Keyed by strategy_key (np_{underlying}_{strike}_{YYYYMM}) come put_roll_flags,
-- così sopravvive a un rebuild della strategy_cache e a un re-import dello snapshot.

CREATE TABLE public.put_roll_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  strategy_key TEXT NOT NULL,
  target NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, portfolio_id, strategy_key)
);

ALTER TABLE public.put_roll_targets ENABLE ROW LEVEL SECURITY;

-- Isolamento per-utente: ciascun utente (admin compreso) gestisce SOLO le proprie righe.
-- Non esiste una policy "admin vede tutto": il target è per definizione privato.
CREATE POLICY "Users manage own put roll targets"
  ON public.put_roll_targets
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_put_roll_targets_user_portfolio
  ON public.put_roll_targets(user_id, portfolio_id);
