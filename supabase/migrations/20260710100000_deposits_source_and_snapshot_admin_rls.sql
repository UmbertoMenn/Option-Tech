-- Già applicata in produzione via connector Lovable il 2026-07-10.
--
-- 1) deposits.source: distingue le righe inserite a mano ('manual', default)
--    da quelle create dall'ingest dei CSV movimenti banca ('csv_auto').
--    L'ingest CSV sovrascrive SOLO le righe 'csv_auto' (idempotenza sul
--    ricaricamento dello stesso file) e non tocca mai quelle manuali.
ALTER TABLE public.deposits ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

-- Backfill: le righe già create dai precedenti ingest CSV sono riconoscibili
-- dalla descrizione (default automatico o testo bancario BONIFICO/GIROCONTO).
UPDATE public.deposits SET source = 'csv_auto'
WHERE description = 'Da movimenti conto (automatico)'
   OR description ~* '\m(BONIFIC|GIROCONT)';

-- 2) monitoring_snapshot: l'admin che consulta il portafoglio di un cliente
--    deve poter salvare lo snapshot di monitoraggio (prima aveva solo la
--    policy di lettura e ogni upsert falliva con errore RLS, lasciando i
--    briefing giornalieri senza fallback fresco).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.monitoring_snapshot'::regclass AND polname = 'Admins can insert all snapshots') THEN
    CREATE POLICY "Admins can insert all snapshots" ON public.monitoring_snapshot
      FOR INSERT WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.monitoring_snapshot'::regclass AND polname = 'Admins can update all snapshots') THEN
    CREATE POLICY "Admins can update all snapshots" ON public.monitoring_snapshot
      FOR UPDATE USING (private.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;
