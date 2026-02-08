-- Rimuovi la policy permissiva esistente
DROP POLICY IF EXISTS "Authenticated users can upsert underlying mappings" ON underlying_mappings;

-- Crea policy che permette solo agli admin di gestire i mapping
CREATE POLICY "Admins can manage underlying mappings"
  ON underlying_mappings
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));