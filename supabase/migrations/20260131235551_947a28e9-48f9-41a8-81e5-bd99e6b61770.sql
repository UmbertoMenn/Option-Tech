-- Enable pg_cron for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Enable pg_net for HTTP calls
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Grant permissions
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- Create price_update_logs table for monitoring
CREATE TABLE public.price_update_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  positions_updated INTEGER DEFAULT 0,
  positions_failed INTEGER DEFAULT 0,
  error_message TEXT,
  source TEXT DEFAULT 'cron'
);

-- Enable RLS but allow service role full access
ALTER TABLE public.price_update_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can view logs
CREATE POLICY "Admins can view price update logs"
  ON public.price_update_logs
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));