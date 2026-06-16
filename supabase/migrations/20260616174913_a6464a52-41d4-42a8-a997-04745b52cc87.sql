
-- 1) Add missing INSERT policy on alerts
CREATE POLICY "Users can insert own alerts"
ON public.alerts
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- 2) Restrict policies to authenticated role (instead of public)
ALTER POLICY "Admins can manage all alerts" ON public.alerts TO authenticated;
ALTER POLICY "Users can delete own alerts" ON public.alerts TO authenticated;
ALTER POLICY "Admins can manage all alert states" ON public.alert_states TO authenticated;
ALTER POLICY "Admins can manage all alert configs" ON public.alert_configs TO authenticated;
ALTER POLICY "Admins can manage all archived underlyings" ON public.archived_underlyings TO authenticated;
ALTER POLICY "Users can manage own archived underlyings" ON public.archived_underlyings TO authenticated;
ALTER POLICY "Admins can manage all covered_call_premiums" ON public.covered_call_premiums TO authenticated;
ALTER POLICY "Users can manage their own covered call premiums" ON public.covered_call_premiums TO authenticated;
ALTER POLICY "Admins can manage all deposits" ON public.deposits TO authenticated;
ALTER POLICY "Users can delete their own deposits" ON public.deposits TO authenticated;
ALTER POLICY "Users can insert their own deposits" ON public.deposits TO authenticated;
ALTER POLICY "Users can update their own deposits" ON public.deposits TO authenticated;
ALTER POLICY "Users can view their own deposits" ON public.deposits TO authenticated;
ALTER POLICY "Admins can manage all derivative_overrides" ON public.derivative_overrides TO authenticated;
ALTER POLICY "Users can delete their own overrides" ON public.derivative_overrides TO authenticated;
ALTER POLICY "Users can insert their own overrides" ON public.derivative_overrides TO authenticated;
ALTER POLICY "Users can update their own overrides" ON public.derivative_overrides TO authenticated;
ALTER POLICY "Users can view their own overrides" ON public.derivative_overrides TO authenticated;
ALTER POLICY "Users can manage own dismissed tickers" ON public.dismissed_unresolved_tickers TO authenticated;
ALTER POLICY "Admins can manage all gp_holdings" ON public.gp_holdings TO authenticated;
ALTER POLICY "Users can delete own gp_holdings" ON public.gp_holdings TO authenticated;
ALTER POLICY "Users can insert own gp_holdings" ON public.gp_holdings TO authenticated;
ALTER POLICY "Users can update own gp_holdings" ON public.gp_holdings TO authenticated;
ALTER POLICY "Users can view own gp_holdings" ON public.gp_holdings TO authenticated;
ALTER POLICY "Admins can manage all historical_data" ON public.historical_data TO authenticated;
ALTER POLICY "Users can delete their own historical data" ON public.historical_data TO authenticated;
ALTER POLICY "Users can insert their own historical data" ON public.historical_data TO authenticated;
ALTER POLICY "Users can update their own historical data" ON public.historical_data TO authenticated;
ALTER POLICY "Users can view their own historical data" ON public.historical_data TO authenticated;
ALTER POLICY "Admins can read all snapshots" ON public.monitoring_snapshot TO authenticated;
ALTER POLICY "Users can read own snapshots" ON public.monitoring_snapshot TO authenticated;
ALTER POLICY "Users can update own snapshots" ON public.monitoring_snapshot TO authenticated;
ALTER POLICY "Users can upsert own snapshots" ON public.monitoring_snapshot TO authenticated;
ALTER POLICY "Admins can manage all latest values" ON public.portfolio_latest_values TO authenticated;
ALTER POLICY "Users can upsert own latest values" ON public.portfolio_latest_values TO authenticated;
ALTER POLICY "Admins can manage all portfolios" ON public.portfolios TO authenticated;
ALTER POLICY "Users can manage own portfolios" ON public.portfolios TO authenticated;
ALTER POLICY "Users can view own portfolios" ON public.portfolios TO authenticated;
ALTER POLICY "Admins can manage all positions" ON public.positions TO authenticated;
ALTER POLICY "Users can manage own positions" ON public.positions TO authenticated;
ALTER POLICY "Users can view own positions" ON public.positions TO authenticated;
ALTER POLICY "Admins can manage all price alerts" ON public.price_alerts TO authenticated;
ALTER POLICY "Admins can view price update logs" ON public.price_update_logs TO authenticated;
ALTER POLICY "Admins can view all profiles" ON public.profiles TO authenticated;
ALTER POLICY "Users can insert own profile" ON public.profiles TO authenticated;
ALTER POLICY "Users can update own profile" ON public.profiles TO authenticated;
ALTER POLICY "Users can view own profile" ON public.profiles TO authenticated;
ALTER POLICY "Admins can manage all strategy toggles" ON public.strategy_alert_toggles TO authenticated;
ALTER POLICY "Users can manage own toggles" ON public.strategy_alert_toggles TO authenticated;
ALTER POLICY "Admins can manage all strategy_cache" ON public.strategy_cache TO authenticated;
ALTER POLICY "Users can delete own strategies" ON public.strategy_cache TO authenticated;
ALTER POLICY "Users can insert own strategies" ON public.strategy_cache TO authenticated;
ALTER POLICY "Users can read own strategies" ON public.strategy_cache TO authenticated;
ALTER POLICY "Users can update own strategies" ON public.strategy_cache TO authenticated;
ALTER POLICY "Admins can manage all strategy_configurations" ON public.strategy_configurations TO authenticated;
ALTER POLICY "Users can delete own strategy_configurations" ON public.strategy_configurations TO authenticated;
ALTER POLICY "Users can insert own strategy_configurations" ON public.strategy_configurations TO authenticated;
ALTER POLICY "Users can update own strategy_configurations" ON public.strategy_configurations TO authenticated;
ALTER POLICY "Users can view own strategy_configurations" ON public.strategy_configurations TO authenticated;
ALTER POLICY "Admins can manage all roles" ON public.user_roles TO authenticated;
ALTER POLICY "Users can view own roles" ON public.user_roles TO authenticated;
