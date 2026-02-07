-- Create table for storing covered call premium calculations
CREATE TABLE public.covered_call_premiums (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  portfolio_id uuid NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  ticker text NOT NULL,
  underlying text NOT NULL,
  orders_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  transaction_cost numeric NOT NULL DEFAULT 10,
  net_per_share numeric NOT NULL DEFAULT 0,
  first_operation_date date,
  last_operation_date date,
  contracts_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT covered_call_premiums_portfolio_ticker_key UNIQUE (portfolio_id, ticker)
);

-- Enable RLS
ALTER TABLE public.covered_call_premiums ENABLE ROW LEVEL SECURITY;

-- Create RLS policy - users can manage their own covered call premiums
CREATE POLICY "Users can manage their own covered call premiums"
ON public.covered_call_premiums
FOR ALL
USING (
  portfolio_id IN (
    SELECT id FROM public.portfolios WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  portfolio_id IN (
    SELECT id FROM public.portfolios WHERE user_id = auth.uid()
  )
);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_covered_call_premiums_updated_at
BEFORE UPDATE ON public.covered_call_premiums
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();