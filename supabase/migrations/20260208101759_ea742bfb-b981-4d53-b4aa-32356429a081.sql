ALTER TABLE historical_data
ADD COLUMN usd_exposure_pct NUMERIC(5,4) DEFAULT 0.8;

COMMENT ON COLUMN historical_data.usd_exposure_pct IS 
  'Esposizione in USD come frazione 0-1, default 0.8 (80%)';