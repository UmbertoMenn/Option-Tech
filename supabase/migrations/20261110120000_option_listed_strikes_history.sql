-- Storico versionato delle catene di strike put quotati (option_listed_strikes).
--
-- option_listed_strikes tiene UNA riga per (ticker, scadenza), sovrascritta a ogni refresh del
-- cron: per una data passata si vedrebbe la catena dell'ultimo aggiornamento, non quella
-- quotata quel giorno. Lo Stress Lab in Visualizzazione Storica deve invece usare le catene
-- quotate ALLA DATA dello snapshot, comprese le scadenze oggi già passate.
--
-- Un trigger su option_listed_strikes archivia una versione (ticker, scadenza, data di
-- quotazione NY) ogni volta che gli strike cambiano: nessuna modifica all'edge function.
-- La RPC listed_strikes_as_of restituisce, per ogni (ticker, scadenza > data), la versione
-- più recente quotata entro la data; se l'archivio non copre la data (catena scaricata solo
-- dopo), la prima versione successiva, marcata con as_of > data.

create table if not exists public.option_listed_strikes_history (
  ticker text not null,
  expiry date not null,
  as_of date not null,
  put_strikes numeric[] not null default '{}',
  spot numeric,
  recorded_at timestamptz not null default now(),
  primary key (ticker, expiry, as_of)
);

alter table public.option_listed_strikes_history enable row level security;

drop policy if exists "option_listed_strikes_history read authenticated" on public.option_listed_strikes_history;
create policy "option_listed_strikes_history read authenticated" on public.option_listed_strikes_history
  for select to authenticated using (true);

drop policy if exists "option_listed_strikes_history admin all" on public.option_listed_strikes_history;
create policy "option_listed_strikes_history admin all" on public.option_listed_strikes_history
  for all to authenticated
  using (private.has_role(auth.uid(), 'admin'::app_role))
  with check (private.has_role(auth.uid(), 'admin'::app_role));

create or replace function public.archive_option_listed_strikes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := (coalesce(new.updated_at, now()) at time zone 'America/New_York')::date;
  prev numeric[];
begin
  select h.put_strikes into prev
  from public.option_listed_strikes_history h
  where h.ticker = new.ticker and h.expiry = new.expiry and h.as_of <= d
  order by h.as_of desc
  limit 1;
  -- Nuova versione solo se la catena è cambiata rispetto all'ultima archiviata.
  if prev is null or prev is distinct from new.put_strikes then
    insert into public.option_listed_strikes_history (ticker, expiry, as_of, put_strikes, spot)
    values (new.ticker, new.expiry, d, new.put_strikes, new.spot)
    on conflict (ticker, expiry, as_of)
      do update set put_strikes = excluded.put_strikes, spot = excluded.spot, recorded_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_archive_option_listed_strikes on public.option_listed_strikes;
create trigger trg_archive_option_listed_strikes
  after insert or update of put_strikes, updated_at on public.option_listed_strikes
  for each row execute function public.archive_option_listed_strikes();

-- Seed: lo stato attuale dell'archivio, datato al suo ultimo aggiornamento (le versioni
-- precedenti sono andate perse con la sovrascrittura).
insert into public.option_listed_strikes_history (ticker, expiry, as_of, put_strikes, spot)
select ticker, expiry, (updated_at at time zone 'America/New_York')::date, put_strikes, spot
from public.option_listed_strikes
on conflict (ticker, expiry, as_of) do nothing;

create or replace function public.listed_strikes_as_of(p_tickers text[], p_date date)
returns table (ticker text, expiry date, put_strikes numeric[], as_of date)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (h.ticker, h.expiry) h.ticker, h.expiry, h.put_strikes, h.as_of
  from public.option_listed_strikes_history h
  where h.ticker = any(p_tickers)
    and h.expiry > p_date
  order by h.ticker, h.expiry,
    (h.as_of <= p_date) desc,                               -- prima le versioni entro la data
    case when h.as_of <= p_date then h.as_of end desc nulls last, -- la più recente entro la data
    h.as_of asc;                                            -- altrimenti la prima successiva
$$;

grant execute on function public.listed_strikes_as_of(text[], date) to authenticated;
