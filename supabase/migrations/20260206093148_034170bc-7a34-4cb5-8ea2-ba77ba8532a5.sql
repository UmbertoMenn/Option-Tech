-- Add policy to allow authenticated users to upsert underlying mappings
CREATE POLICY "Authenticated users can upsert underlying mappings"
  ON public.underlying_mappings
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);