-- Add "PUT da rollare al rialzo" alert types to the alert_type enum.
-- Dedicated migration (ALTER TYPE ADD VALUE must run outside the txn that uses it).
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'action_put_roll_up_otm';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'distance_put_roll_up';
