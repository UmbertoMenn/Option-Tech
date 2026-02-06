-- Fase 1.1: Estendere tabella profiles per preferenze notifiche
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notify_email boolean DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notify_telegram boolean DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS telegram_chat_id text;

-- Fase 1.2: Creare tabella notification_logs per tracciare le notifiche
CREATE TABLE IF NOT EXISTS public.notification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid REFERENCES public.alerts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'telegram')),
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message text,
  created_at timestamptz DEFAULT now()
);

-- RLS per notification_logs
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notification logs"
  ON public.notification_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy per permettere all'edge function (service role) di inserire log
CREATE POLICY "Service role can insert notification logs"
  ON public.notification_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Fase 1.3: Creare tabella telegram_link_codes per il linking Telegram
CREATE TABLE IF NOT EXISTS public.telegram_link_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  used_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- RLS per telegram_link_codes
ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own link codes"
  ON public.telegram_link_codes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own link codes"
  ON public.telegram_link_codes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Fase 1.4: Creare Database Trigger per notifiche
CREATE OR REPLACE FUNCTION public.notify_on_new_alert()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://uareyloxlpvaxmzygpgo.supabase.co/functions/v1/send-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
    ),
    body := jsonb_build_object(
      'alert_id', NEW.id,
      'user_id', NEW.user_id,
      'ticker', NEW.ticker,
      'message', NEW.message,
      'severity', NEW.severity,
      'alert_type', NEW.alert_type,
      'portfolio_id', NEW.portfolio_id
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Creare il trigger
DROP TRIGGER IF EXISTS on_new_alert ON public.alerts;
CREATE TRIGGER on_new_alert
  AFTER INSERT ON public.alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_new_alert();

-- Indice per performance
CREATE INDEX IF NOT EXISTS idx_notification_logs_user_id ON public.notification_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_alert_id ON public.notification_logs(alert_id);
CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_code ON public.telegram_link_codes(code);
CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_expires ON public.telegram_link_codes(expires_at);