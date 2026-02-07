-- Add equity_exposure_pct column to historical_data table
ALTER TABLE historical_data 
ADD COLUMN equity_exposure_pct numeric DEFAULT 0.6;

-- Add comment for documentation
COMMENT ON COLUMN historical_data.equity_exposure_pct IS 
  'Equity exposure % (0-1) del portafoglio alla data dello snapshot. Usata per calcolare il benchmark nel periodo successivo.';