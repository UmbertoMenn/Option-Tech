-- Add new alert types to enum
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'price_alert_above';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'price_alert_below';

-- Create price_alerts table
CREATE TABLE public.price_alerts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    ticker text NOT NULL,
    direction text NOT NULL CHECK (direction IN ('above', 'below')),
    target_price numeric NOT NULL CHECK (target_price > 0),
    enabled boolean NOT NULL DEFAULT true,
    last_triggered_at timestamptz,
    cooldown_minutes integer NOT NULL DEFAULT 240,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id, ticker, direction, target_price)
);

-- Create indexes
CREATE INDEX idx_price_alerts_user_enabled ON price_alerts(user_id, enabled);
CREATE INDEX idx_price_alerts_ticker ON price_alerts(ticker);

-- Enable RLS
ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own price alerts"
    ON price_alerts FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own price alerts"
    ON price_alerts FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own price alerts"
    ON price_alerts FOR UPDATE TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own price alerts"
    ON price_alerts FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER set_price_alerts_updated_at
    BEFORE UPDATE ON price_alerts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();