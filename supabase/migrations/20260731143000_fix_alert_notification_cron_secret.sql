-- Ripristina le notifiche generate dal trigger AFTER INSERT su public.alerts.
--
-- send-notification richiede x-cron-secret, ma la definizione storica di
-- notify_on_new_alert inviava soltanto Content-Type e Authorization. Il
-- segreto viene letto dal Vault, che e' gia' la fonte autoritativa usata dalla
-- validazione dell'Edge Function tramite public.verify_cron_secret.

CREATE OR REPLACE FUNCTION public.notify_on_new_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cron_secret text;
BEGIN
  SELECT decrypted_secret
  INTO v_cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;

  IF v_cron_secret IS NULL OR length(v_cron_secret) = 0 THEN
    RAISE WARNING 'notify_on_new_alert: cron_secret missing from Vault; notification not dispatched for alert %', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://uareyloxlpvaxmzygpgo.supabase.co/functions/v1/send-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true),
      'x-cron-secret', v_cron_secret
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
$function$;

-- Mantiene le restrizioni gia' applicate dalle migration di hardening.
REVOKE ALL ON FUNCTION public.notify_on_new_alert() FROM PUBLIC, anon, authenticated;
