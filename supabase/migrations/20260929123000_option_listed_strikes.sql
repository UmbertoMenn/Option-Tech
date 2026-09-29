-- Archivio strike put quotati per ticker/scadenza (scritto da update-option-prices-cron),
-- usato dal rolling dello Stress Lab per scegliere la put di arrivo fra strike reali.
-- Applicata in produzione il 29/09/2026.
create table if not exists public.option_listed_strikes (
  ticker text not null,
  expiry date not null,
  put_strikes numeric[] not null default '{}',
  spot numeric,
  updated_at timestamptz not null default now(),
  primary key (ticker, expiry)
);

alter table public.option_listed_strikes enable row level security;

create policy "option_listed_strikes read authenticated" on public.option_listed_strikes
  for select to authenticated using (true);

create policy "option_listed_strikes admin all" on public.option_listed_strikes
  for all to authenticated
  using (private.has_role(auth.uid(), 'admin'::app_role))
  with check (private.has_role(auth.uid(), 'admin'::app_role));
