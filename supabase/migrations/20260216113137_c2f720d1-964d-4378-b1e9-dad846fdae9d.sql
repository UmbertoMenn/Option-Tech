
-- Add option_symbol column
ALTER TABLE covered_call_premiums
  ADD COLUMN option_symbol text;

-- Populate existing records
UPDATE covered_call_premiums SET option_symbol = '' WHERE option_symbol IS NULL;

-- Make NOT NULL with default
ALTER TABLE covered_call_premiums
  ALTER COLUMN option_symbol SET NOT NULL,
  ALTER COLUMN option_symbol SET DEFAULT '';

-- Replace unique constraint
DROP INDEX IF EXISTS covered_call_premiums_portfolio_id_ticker_key;
CREATE UNIQUE INDEX covered_call_premiums_portfolio_ticker_symbol_key
  ON covered_call_premiums (portfolio_id, ticker, option_symbol);
