-- Add sector and industry columns to isin_mappings table
ALTER TABLE isin_mappings
ADD COLUMN IF NOT EXISTS sector text,
ADD COLUMN IF NOT EXISTS industry text;