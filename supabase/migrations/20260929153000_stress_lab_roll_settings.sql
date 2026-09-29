-- Una configurazione rolling per utente, condivisa tra i suoi portafogli.
-- L'admin che visualizza un cliente legge e modifica la configurazione del cliente.
CREATE TABLE IF NOT EXISTS public.stress_lab_roll_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  trigger_pct NUMERIC NOT NULL DEFAULT 2 CHECK (trigger_pct BETWEEN 0 AND 15),
  max_months_forward INTEGER NOT NULL DEFAULT 12 CHECK (max_months_forward BETWEEN 1 AND 24),
  strike_step_pct NUMERIC NOT NULL DEFAULT 5 CHECK (strike_step_pct BETWEEN 0.5 AND 10),
  min_net_credit_pct NUMERIC NOT NULL DEFAULT 0 CHECK (min_net_credit_pct BETWEEN 0 AND 3),
  max_rolls INTEGER NOT NULL DEFAULT 11 CHECK (max_rolls BETWEEN 1 AND 20),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.stress_lab_roll_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.stress_lab_roll_settings TO authenticated;

DROP POLICY IF EXISTS "Users and admins manage roll settings" ON public.stress_lab_roll_settings;
CREATE POLICY "Users and admins manage roll settings"
  ON public.stress_lab_roll_settings
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS update_stress_lab_roll_settings_updated_at ON public.stress_lab_roll_settings;
CREATE TRIGGER update_stress_lab_roll_settings_updated_at
  BEFORE UPDATE ON public.stress_lab_roll_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
