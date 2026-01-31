-- Create a table for deposit entries
CREATE TABLE public.deposits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  deposit_date DATE NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(portfolio_id, deposit_date)
);

-- Enable Row Level Security
ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own deposits" 
ON public.deposits 
FOR SELECT 
USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert their own deposits" 
ON public.deposits 
FOR INSERT 
WITH CHECK (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

CREATE POLICY "Users can update their own deposits" 
ON public.deposits 
FOR UPDATE 
USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete their own deposits" 
ON public.deposits 
FOR DELETE 
USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_deposits_updated_at
BEFORE UPDATE ON public.deposits
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();