-- Add snapshot_date column to portfolios table
ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS snapshot_date DATE;