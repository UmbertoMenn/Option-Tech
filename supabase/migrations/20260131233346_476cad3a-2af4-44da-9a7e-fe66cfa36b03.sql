-- Create table for caching ISIN to ticker mappings
CREATE TABLE public.isin_mappings (
  isin TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  exchange TEXT,
  source TEXT NOT NULL, -- 'openfigi', 'yahoo', 'justetf', 'manual'
  last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.isin_mappings ENABLE ROW LEVEL SECURITY;

-- Anyone can read ISIN mappings (shared data)
CREATE POLICY "Anyone can read ISIN mappings"
ON public.isin_mappings
FOR SELECT
USING (true);

-- Create index for faster lookups
CREATE INDEX idx_isin_mappings_ticker ON public.isin_mappings(ticker);