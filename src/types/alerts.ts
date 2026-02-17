// Alert type enum values
export const ALERT_TYPES = {
  // Distance alerts (configurable per ticker)
  DISTANCE_IRON_CONDOR_CALL: 'distance_iron_condor_call',
  DISTANCE_IRON_CONDOR_PUT: 'distance_iron_condor_put',
  DISTANCE_DOUBLE_DIAGONAL_CALL: 'distance_double_diagonal_call',
  DISTANCE_DOUBLE_DIAGONAL_PUT: 'distance_double_diagonal_put',
  DISTANCE_ALTERNATIVE_DD_CALL: 'distance_alternative_dd_call',
  DISTANCE_ALTERNATIVE_DD_PUT: 'distance_alternative_dd_put',
  DISTANCE_COVERED_CALL: 'distance_covered_call',
  DISTANCE_NAKED_PUT: 'distance_naked_put',
  // Action alerts (fixed thresholds)
  ACTION_NAKED_PUT_ITM: 'action_naked_put_itm',
  ACTION_COVERED_CALL_ITM: 'action_covered_call_itm',
  ACTION_DD_IC_OOR: 'action_dd_ic_oor',
  ACTION_STRATEGY_OOB: 'action_strategy_oob',
  ACTION_LEAP_GAIN_20: 'action_leap_gain_20',
  ACTION_LEAP_GAIN_30: 'action_leap_gain_30',
  ACTION_LEAP_GAIN_40: 'action_leap_gain_40',
  ACTION_LEAP_GAIN_50: 'action_leap_gain_50',
  // Price alerts (custom ticker monitoring)
  PRICE_ALERT_ABOVE: 'price_alert_above',
  PRICE_ALERT_BELOW: 'price_alert_below',
} as const;

export type AlertType = typeof ALERT_TYPES[keyof typeof ALERT_TYPES];

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type AlertStateStatus = 'safe' | 'alerted';

// Distance alert types (configurable thresholds)
export const DISTANCE_ALERT_TYPES: AlertType[] = [
  ALERT_TYPES.DISTANCE_IRON_CONDOR_CALL,
  ALERT_TYPES.DISTANCE_IRON_CONDOR_PUT,
  ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_CALL,
  ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_PUT,
  ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_CALL,
  ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_PUT,
  ALERT_TYPES.DISTANCE_COVERED_CALL,
  ALERT_TYPES.DISTANCE_NAKED_PUT,
];

// Action alert types (on/off toggles)
export const ACTION_ALERT_TYPES: AlertType[] = [
  ALERT_TYPES.ACTION_NAKED_PUT_ITM,
  ALERT_TYPES.ACTION_COVERED_CALL_ITM,
  ALERT_TYPES.ACTION_DD_IC_OOR,
  ALERT_TYPES.ACTION_STRATEGY_OOB,
];

// Leap gain alert types
export const LEAP_GAIN_ALERT_TYPES: AlertType[] = [
  ALERT_TYPES.ACTION_LEAP_GAIN_20,
  ALERT_TYPES.ACTION_LEAP_GAIN_30,
  ALERT_TYPES.ACTION_LEAP_GAIN_40,
  ALERT_TYPES.ACTION_LEAP_GAIN_50,
];

// Price alert types
export const PRICE_ALERT_TYPES: AlertType[] = [
  ALERT_TYPES.PRICE_ALERT_ABOVE,
  ALERT_TYPES.PRICE_ALERT_BELOW,
];

// Human-readable labels for alert types (Italian)
export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  [ALERT_TYPES.DISTANCE_IRON_CONDOR_CALL]: 'Iron Condor - lato Call',
  [ALERT_TYPES.DISTANCE_IRON_CONDOR_PUT]: 'Iron Condor - lato Put',
  [ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_CALL]: 'Double Diagonal - lato Call',
  [ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_PUT]: 'Double Diagonal - lato Put',
  [ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_CALL]: 'Alternative DD - lato Call',
  [ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_PUT]: 'Alternative DD - lato Put',
  [ALERT_TYPES.DISTANCE_COVERED_CALL]: 'Covered Call',
  [ALERT_TYPES.DISTANCE_NAKED_PUT]: 'Naked Put',
  [ALERT_TYPES.ACTION_NAKED_PUT_ITM]: 'Naked Put ITM',
  [ALERT_TYPES.ACTION_COVERED_CALL_ITM]: 'Covered Call ITM',
  [ALERT_TYPES.ACTION_DD_IC_OOR]: 'DD/IC Out of Range',
  [ALERT_TYPES.ACTION_STRATEGY_OOB]: 'Strategie OOB',
  [ALERT_TYPES.ACTION_LEAP_GAIN_20]: 'Leap +20%',
  [ALERT_TYPES.ACTION_LEAP_GAIN_30]: 'Leap +30%',
  [ALERT_TYPES.ACTION_LEAP_GAIN_40]: 'Leap +40%',
  [ALERT_TYPES.ACTION_LEAP_GAIN_50]: 'Leap +50%',
  [ALERT_TYPES.PRICE_ALERT_ABOVE]: 'Prezzo sopra soglia',
  [ALERT_TYPES.PRICE_ALERT_BELOW]: 'Prezzo sotto soglia',
};

// Alert configuration (user settings)
export interface AlertConfig {
  id: string;
  user_id: string;
  ticker: string | null; // NULL = global default
  alert_type: AlertType;
  threshold_pct: number;
  cooldown_minutes: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

// Alert state (for direction-aware crossing detection)
export interface AlertState {
  id: string;
  user_id: string;
  portfolio_id: string;
  position_key: string;
  alert_type: AlertType;
  current_state: AlertStateStatus;
  last_alerted_at: string | null;
  updated_at: string;
}

// Generated alert
export interface Alert {
  id: string;
  user_id: string;
  portfolio_id: string;
  alert_type: AlertType;
  ticker: string;
  strategy_type: string | null;
  direction: 'up' | 'down' | null;
  current_value: number | null;
  threshold_value: number | null;
  strike_price: number | null;
  underlying_price: number | null;
  message: string;
  severity: AlertSeverity;
  created_at: string;
  read_at: string | null;
}

// Price alert interface
export interface PriceAlert {
  id: string;
  user_id: string;
  ticker: string;
  direction: 'above' | 'below';
  target_price: number;
  enabled: boolean;
  last_triggered_at: string | null;
  cooldown_minutes: number;
  delete_after_trigger: boolean;
  created_at: string;
  updated_at: string;
}

// Default thresholds for distance alerts
export const DEFAULT_DISTANCE_THRESHOLD_PCT = 2;

// Default cooldown in minutes (8 hours)
export const DEFAULT_COOLDOWN_MINUTES = 480;

// Grouped distance alert types for UI display
export const GROUPED_DISTANCE_ALERTS = [
  {
    label: 'Covered Call',
    callType: ALERT_TYPES.DISTANCE_COVERED_CALL,
    putType: null,
  },
  {
    label: 'Naked Put',
    callType: null,
    putType: ALERT_TYPES.DISTANCE_NAKED_PUT,
  },
  {
    label: 'Iron Condor',
    callType: ALERT_TYPES.DISTANCE_IRON_CONDOR_CALL,
    putType: ALERT_TYPES.DISTANCE_IRON_CONDOR_PUT,
  },
  {
    label: 'Double Diagonal',
    callType: ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_CALL,
    putType: ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_PUT,
  },
  {
    label: 'Alternative DD',
    callType: ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_CALL,
    putType: ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_PUT,
  },
];
