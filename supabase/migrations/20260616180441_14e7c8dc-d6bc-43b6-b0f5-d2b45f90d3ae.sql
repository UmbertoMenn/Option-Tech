-- 1. Cleanup polluted ticker_fundamentals rows (raw underlying names instead of clean tickers)
DELETE FROM public.ticker_fundamentals
WHERE ticker !~ '^[A-Z0-9.\-^=]+$';

-- 2. Reschedule beta update cron: weekly -> monthly (day 16 at 03:00 UTC)
DO $$
BEGIN
  PERFORM cron.unschedule('update-beta-weekly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('update-beta-monthly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'update-beta-monthly',
  '0 3 16 * *',
  $job$
  SELECT net.http_post(
    url:='https://uareyloxlpvaxmzygpgo.supabase.co/functions/v1/update-beta-cron',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhcmV5bG94bHB2YXhtenlncGdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk2NzY5MjYsImV4cCI6MjA4NTI1MjkyNn0.XRdbbCpwFPq-TgEB8FUUaGvs6F_RXM0YFahUzXmkzLY"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  );
  $job$
);