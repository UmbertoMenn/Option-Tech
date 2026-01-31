-- Create table to cache ETF allocation data from justETF
CREATE TABLE public.etf_allocations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  isin TEXT NOT NULL UNIQUE,
  name TEXT,
  country_allocations JSONB NOT NULL DEFAULT '{}',
  currency_allocations JSONB NOT NULL DEFAULT '{}',
  is_hedged BOOLEAN DEFAULT false,
  last_fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for faster lookups
CREATE INDEX idx_etf_allocations_isin ON public.etf_allocations(isin);

-- Enable RLS
ALTER TABLE public.etf_allocations ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read ETF allocations (shared data)
CREATE POLICY "Anyone can read ETF allocations" 
ON public.etf_allocations 
FOR SELECT 
USING (true);

-- Only allow inserts/updates via edge functions (service role)
-- No user-level insert/update policies needed

-- Create trigger for updated_at
CREATE TRIGGER update_etf_allocations_updated_at
BEFORE UPDATE ON public.etf_allocations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();