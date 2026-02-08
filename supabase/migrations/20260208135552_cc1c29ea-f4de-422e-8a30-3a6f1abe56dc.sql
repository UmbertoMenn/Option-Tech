-- =====================================================
-- Admin RLS Policies per Gestione Portafogli
-- =====================================================

-- Portfolios: Admin può gestire tutti i portafogli
CREATE POLICY "Admins can manage all portfolios"
  ON public.portfolios FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Positions: Admin può gestire tutte le posizioni
CREATE POLICY "Admins can manage all positions"
  ON public.positions FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Deposits: Admin può gestire tutti i depositi
CREATE POLICY "Admins can manage all deposits"
  ON public.deposits FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Historical Data: Admin può gestire tutti i dati storici
CREATE POLICY "Admins can manage all historical_data"
  ON public.historical_data FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Derivative Overrides: Admin può gestire tutti gli override derivati
CREATE POLICY "Admins can manage all derivative_overrides"
  ON public.derivative_overrides FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Covered Call Premiums: Admin può gestire tutti i premi covered call
CREATE POLICY "Admins can manage all covered_call_premiums"
  ON public.covered_call_premiums FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Strategy Cache: Admin può gestire tutte le strategie in cache
CREATE POLICY "Admins can manage all strategy_cache"
  ON public.strategy_cache FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));