-- Rolling put ITM selezionate (Stress Lab): parametri e selezione per utente.
-- Applicata in produzione il 29/09/2026.
alter table public.stress_lab_roll_settings add column if not exists itm_trigger_pct numeric not null default 5 check (itm_trigger_pct between 0 and 30);
alter table public.stress_lab_roll_settings add column if not exists itm_strike_step_pct numeric not null default 5 check (itm_strike_step_pct between 0.5 and 20);
alter table public.stress_lab_roll_settings add column if not exists itm_min_time_pct numeric not null default 25 check (itm_min_time_pct between 0 and 100);
alter table public.stress_lab_roll_settings add column if not exists itm_selected text[] not null default '{}';
