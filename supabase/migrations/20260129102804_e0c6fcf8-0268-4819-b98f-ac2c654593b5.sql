-- Add initial value and date columns to portfolios table
ALTER TABLE public.portfolios 
ADD COLUMN initial_value numeric DEFAULT NULL,
ADD COLUMN initial_date date DEFAULT NULL;