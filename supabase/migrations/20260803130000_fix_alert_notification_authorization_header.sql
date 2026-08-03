-- Rende deterministico l'header Authorization inviato dal trigger AFTER INSERT
-- su public.alerts.
--
-- La definizione precedente costruiva l'header cosi':
--
--   'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
--
-- Quella GUC non esiste in questo database (verificato: current_setting
-- restituisce NULL), quindi la concatenazione produce NULL e jsonb_build_object
-- emette 'Authorization': null. Oggi la chiamata passa solo perche'
-- send-notification e' configurata con verify_jwt = false: al primo ripristino
-- della verifica JWT lato piattaforma il gateway rifiuterebbe la richiesta e le
-- notifiche sparirebbero in silenzio, con la riga di alert regolarmente scritta
-- a database.
--
-- Si adotta lo stesso schema dei job pg_cron gia' funzionanti: anon key su
-- Authorization e apikey, segreto operativo su x-cron-secret (l'unico
-- effettivamente validato da send-notification tramite public.verify_cron_secret).
-- Viene inoltre fissato un timeout esplicito: il default di pg_net e' 5 secondi,
-- sotto il tempo di risposta tipico della funzione quando invia su Telegram.

CREATE OR REPLACE FUNCTION public.notify_on_new_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cron_secret text;
  v_anon_key constant text :=
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhcmV5bG94bHB2YXhtenlncGdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk2NzY5MjYsImV4cCI6MjA4NTI1MjkyNn0.XRdbbCpwFPq-TgEB8FUUaGvs6F_RXM0YFahUzXmkzLY';
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
      'Authorization', 'Bearer ' || v_anon_key,
      'apikey', v_anon_key,
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
    ),
    timeout_milliseconds := 30000
  );

  RETURN NEW;
END;
$function$;

-- Mantiene le restrizioni gia' applicate dalle migration di hardening.
REVOKE ALL ON FUNCTION public.notify_on_new_alert() FROM PUBLIC, anon, authenticated;
