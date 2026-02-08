-- Add delete_after_trigger column to price_alerts
ALTER TABLE public.price_alerts 
ADD COLUMN delete_after_trigger boolean NOT NULL DEFAULT false;