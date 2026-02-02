-- Aggiunge il campo netting_ex_cc_np alla tabella historical_data
ALTER TABLE public.historical_data 
ADD COLUMN IF NOT EXISTS netting_ex_cc_np numeric DEFAULT 0 NOT NULL;