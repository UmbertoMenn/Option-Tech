-- Fix 42501: gli admin (private banker) operano sui portafogli dei clienti,
-- intestati ad altri user. Senza una policy admin, il check "proprietario"
-- fallisce. Allineo put_roll_flags alle altre tabelle (derivative_overrides,
-- strategy_cache, ...) che hanno "Admins can manage all".
CREATE POLICY "Admins can manage all put_roll_flags"
  ON public.put_roll_flags
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));
