-- Create enum types for alert system
CREATE TYPE public.alert_type AS ENUM (
  'distance_iron_condor_call',
  'distance_iron_condor_put',
  'distance_double_diagonal_call',
  'distance_double_diagonal_put',
  'distance_alternative_dd_call',
  'distance_alternative_dd_put',
  'distance_covered_call',
  'distance_naked_put',
  'action_naked_put_itm',
  'action_covered_call_itm',
  'action_dd_ic_oor',
  'action_strategy_oob',
  'action_leap_gain_20',
  'action_leap_gain_30',
  'action_leap_gain_40',
  'action_leap_gain_50'
);

CREATE TYPE public.alert_severity AS ENUM ('info', 'warning', 'critical');
CREATE TYPE public.alert_state_status AS ENUM ('safe', 'alerted');

-- Table: alert_configs - User configuration for alert thresholds
CREATE TABLE public.alert_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  ticker TEXT,
  alert_type public.alert_type NOT NULL,
  threshold_pct NUMERIC(5,2) DEFAULT 5.00,
  cooldown_minutes INTEGER DEFAULT 240,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, ticker, alert_type)
);

ALTER TABLE public.alert_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own alert configs"
  ON public.alert_configs FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Trigger for updated_at
CREATE TRIGGER update_alert_configs_updated_at
  BEFORE UPDATE ON public.alert_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Table: alert_states - Tracks current state for direction-aware crossing
CREATE TABLE public.alert_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE CASCADE,
  position_key TEXT NOT NULL,
  alert_type public.alert_type NOT NULL,
  current_state public.alert_state_status DEFAULT 'safe',
  last_alerted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, portfolio_id, position_key, alert_type)
);

ALTER TABLE public.alert_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own alert states"
  ON public.alert_states FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER update_alert_states_updated_at
  BEFORE UPDATE ON public.alert_states
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Table: alerts - Generated alerts
CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE CASCADE,
  alert_type public.alert_type NOT NULL,
  ticker TEXT NOT NULL,
  strategy_type TEXT,
  direction TEXT,
  current_value NUMERIC,
  threshold_value NUMERIC,
  strike_price NUMERIC,
  underlying_price NUMERIC,
  message TEXT NOT NULL,
  severity public.alert_severity DEFAULT 'warning',
  created_at TIMESTAMPTZ DEFAULT now(),
  read_at TIMESTAMPTZ
);

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own alerts"
  ON public.alerts FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own alerts"
  ON public.alerts FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Indexes for performance
CREATE INDEX idx_alerts_user_created ON public.alerts(user_id, created_at DESC);
CREATE INDEX idx_alerts_unread ON public.alerts(user_id) WHERE read_at IS NULL;
CREATE INDEX idx_alert_configs_user ON public.alert_configs(user_id);
CREATE INDEX idx_alert_states_user_portfolio ON public.alert_states(user_id, portfolio_id);