-- Call da rivendere (call_buybacks): riacquisti suddivisi in TRANCHE.
--
-- Problema: la chiave univoca era (portfolio_id, descriptor, buyback_date).
-- Un riacquisto eseguito in più tranche nello stesso giorno a prezzi diversi
-- (es. 2 contratti a 4,10 + 3 contratti a 4,35) veniva rifiutato con
-- "duplicate key value violates unique constraint": impossibile registrare il
-- secondo lotto, né da CSV Movimenti Titoli né dal form manuale.
--
-- Soluzione: il prezzo di riacquisto entra nella chiave. Ogni tranche a prezzo
-- diverso è una riga a sé (ognuna con il proprio G/P potenziale), mentre
-- l'idempotenza del ricaricamento dello stesso file resta garantita: la stessa
-- tranche (stesso descrittore, stessa data, stesso prezzo) continua a
-- collassare sulla riga esistente invece di duplicarsi.
--
-- NB: il cron opzioni aggiorna market_price per id, con chiave logica
-- underlying+strike+expiry, quindi ogni tranche viene prezzata correttamente
-- senza alcuna modifica al cron.

ALTER TABLE public.call_buybacks
  DROP CONSTRAINT IF EXISTS call_buybacks_portfolio_id_descriptor_buyback_date_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'call_buybacks_tranche_key'
  ) THEN
    ALTER TABLE public.call_buybacks
      ADD CONSTRAINT call_buybacks_tranche_key
      UNIQUE (portfolio_id, descriptor, buyback_date, buyback_price);
  END IF;
END $$;
