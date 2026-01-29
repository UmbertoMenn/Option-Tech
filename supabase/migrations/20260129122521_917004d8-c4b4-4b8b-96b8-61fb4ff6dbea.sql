-- Add average_balance_date column to portfolios table
ALTER TABLE public.portfolios 
ADD COLUMN average_balance_date DATE NULL;