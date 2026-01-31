-- Create historical_data table for storing portfolio snapshots
CREATE TABLE public.historical_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  total_value NUMERIC NOT NULL DEFAULT 0,
  netting_total NUMERIC NOT NULL DEFAULT 0,
  netting_ex_cc NUMERIC NOT NULL DEFAULT 0,
  deposits NUMERIC NOT NULL DEFAULT 0,
  average_balance NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(portfolio_id, snapshot_date)
);

-- Enable RLS
ALTER TABLE public.historical_data ENABLE ROW LEVEL SECURITY;

-- RLS Policies - users can only access their own data through portfolio ownership
CREATE POLICY "Users can view their own historical data"
  ON public.historical_data
  FOR SELECT
  USING (
    portfolio_id IN (
      SELECT id FROM public.portfolios WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own historical data"
  ON public.historical_data
  FOR INSERT
  WITH CHECK (
    portfolio_id IN (
      SELECT id FROM public.portfolios WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own historical data"
  ON public.historical_data
  FOR UPDATE
  USING (
    portfolio_id IN (
      SELECT id FROM public.portfolios WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own historical data"
  ON public.historical_data
  FOR DELETE
  USING (
    portfolio_id IN (
      SELECT id FROM public.portfolios WHERE user_id = auth.uid()
    )
  );

-- Add trigger for updated_at
CREATE TRIGGER update_historical_data_updated_at
  BEFORE UPDATE ON public.historical_data
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();