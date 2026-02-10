
-- Admin policies for alert_configs
CREATE POLICY "Admins can manage all alert configs"
  ON public.alert_configs FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Admin policies for alert_states
CREATE POLICY "Admins can manage all alert states"
  ON public.alert_states FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Admin policies for alerts
CREATE POLICY "Admins can manage all alerts"
  ON public.alerts FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Admin policies for price_alerts
CREATE POLICY "Admins can manage all price alerts"
  ON public.price_alerts FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));
