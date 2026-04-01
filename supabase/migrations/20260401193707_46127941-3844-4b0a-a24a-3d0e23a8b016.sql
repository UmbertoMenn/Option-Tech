CREATE TABLE public.archived_underlyings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  portfolio_id uuid NOT NULL,
  underlying_key text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, portfolio_id, underlying_key)
);

ALTER TABLE public.archived_underlyings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own archived underlyings"
  ON public.archived_underlyings
  FOR ALL TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can manage all archived underlyings"
  ON public.archived_underlyings
  FOR ALL TO public
  USING (has_role(auth.uid(), 'admin'::app_role));