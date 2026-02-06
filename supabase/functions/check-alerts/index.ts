import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Alert type enum values
const ALERT_TYPES = {
  DISTANCE_IRON_CONDOR_CALL: 'distance_iron_condor_call',
  DISTANCE_IRON_CONDOR_PUT: 'distance_iron_condor_put',
  DISTANCE_DOUBLE_DIAGONAL_CALL: 'distance_double_diagonal_call',
  DISTANCE_DOUBLE_DIAGONAL_PUT: 'distance_double_diagonal_put',
  DISTANCE_ALTERNATIVE_DD_CALL: 'distance_alternative_dd_call',
  DISTANCE_ALTERNATIVE_DD_PUT: 'distance_alternative_dd_put',
  DISTANCE_COVERED_CALL: 'distance_covered_call',
  DISTANCE_NAKED_PUT: 'distance_naked_put',
  ACTION_NAKED_PUT_ITM: 'action_naked_put_itm',
  ACTION_COVERED_CALL_ITM: 'action_covered_call_itm',
  ACTION_DD_IC_OOR: 'action_dd_ic_oor',
  ACTION_STRATEGY_OOB: 'action_strategy_oob',
  ACTION_LEAP_GAIN_20: 'action_leap_gain_20',
  ACTION_LEAP_GAIN_30: 'action_leap_gain_30',
  ACTION_LEAP_GAIN_40: 'action_leap_gain_40',
  ACTION_LEAP_GAIN_50: 'action_leap_gain_50',
  PRICE_ALERT_ABOVE: 'price_alert_above',
  PRICE_ALERT_BELOW: 'price_alert_below',
};

const DEFAULT_THRESHOLD_PCT = 5;
const DEFAULT_COOLDOWN_MINUTES = 240;

interface AlertConfig {
  alert_type: string;
  ticker: string | null;
  threshold_pct: number;
  cooldown_minutes: number;
  enabled: boolean;
}

interface AlertState {
  id: string;
  position_key: string;
  alert_type: string;
  current_state: 'safe' | 'alerted';
  last_alerted_at: string | null;
}

interface Position {
  id: string;
  portfolio_id: string;
  asset_type: string;
  description: string;
  ticker: string | null;
  underlying: string | null;
  option_type: string | null;
  strike_price: number | null;
  quantity: number;
  current_price: number | null;
  avg_cost: number | null;
  expiry_date: string | null;
}

// Get effective config for alert type and ticker
function getEffectiveConfig(
  configs: AlertConfig[],
  alertType: string,
  ticker?: string
): { threshold_pct: number; cooldown_minutes: number; enabled: boolean } {
  // First try ticker-specific
  if (ticker) {
    const tickerConfig = configs.find(
      c => c.alert_type === alertType && c.ticker?.toUpperCase() === ticker.toUpperCase()
    );
    if (tickerConfig) {
      return {
        threshold_pct: tickerConfig.threshold_pct,
        cooldown_minutes: tickerConfig.cooldown_minutes,
        enabled: tickerConfig.enabled,
      };
    }
  }
  
  // Fall back to global
  const globalConfig = configs.find(c => c.alert_type === alertType && c.ticker === null);
  if (globalConfig) {
    return {
      threshold_pct: globalConfig.threshold_pct,
      cooldown_minutes: globalConfig.cooldown_minutes,
      enabled: globalConfig.enabled,
    };
  }
  
  return {
    threshold_pct: DEFAULT_THRESHOLD_PCT,
    cooldown_minutes: DEFAULT_COOLDOWN_MINUTES,
    enabled: true,
  };
}

// Check if cooldown has passed
function cooldownPassed(lastAlertedAt: string | null, cooldownMinutes: number): boolean {
  if (!lastAlertedAt) return true;
  const lastAlerted = new Date(lastAlertedAt);
  const now = new Date();
  const diffMs = now.getTime() - lastAlerted.getTime();
  const diffMinutes = diffMs / (1000 * 60);
  return diffMinutes >= cooldownMinutes;
}

// Calculate distance percentage for CALL (price rising toward strike)
function calcCallDistance(underlyingPrice: number, strikePrice: number): number {
  if (underlyingPrice <= 0) return 100;
  return ((strikePrice - underlyingPrice) / underlyingPrice) * 100;
}

// Calculate distance percentage for PUT (price falling toward strike)
function calcPutDistance(underlyingPrice: number, strikePrice: number): number {
  if (underlyingPrice <= 0) return 100;
  return ((underlyingPrice - strikePrice) / underlyingPrice) * 100;
}

// Normalize string for matching
function normalizeForMatching(str: string): string {
  return str
    .toUpperCase()
    .replace(/\s+(INC|CORP|LTD|PLC|AG|SA|SPA|ADR|CLASS\s*[A-Z]?)\.?$/gi, '')
    .replace(/^AZ\.\s*/i, '')
    .trim();
}

// Get ticker from position
function getTicker(position: Position): string {
  return position.ticker || position.description?.split(' ')[0] || 'N/A';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    
    console.log('Starting check-alerts cron job...');
    
    // Get all users with alert configs
    const { data: usersWithConfigs, error: usersError } = await supabase
      .from('alert_configs')
      .select('user_id')
      .eq('enabled', true);
    
    if (usersError) throw usersError;
    
    const uniqueUserIds = [...new Set(usersWithConfigs?.map(c => c.user_id) || [])];
    console.log(`Found ${uniqueUserIds.length} users with alert configs`);
    
    let totalAlertsCreated = 0;
    
    for (const userId of uniqueUserIds) {
      // Get user's alert configs
      const { data: configs, error: configsError } = await supabase
        .from('alert_configs')
        .select('*')
        .eq('user_id', userId);
      
      if (configsError) {
        console.error(`Error fetching configs for user ${userId}:`, configsError);
        continue;
      }
      
      // Get user's portfolios
      const { data: portfolios, error: portfoliosError } = await supabase
        .from('portfolios')
        .select('id')
        .eq('user_id', userId);
      
      if (portfoliosError) {
        console.error(`Error fetching portfolios for user ${userId}:`, portfoliosError);
        continue;
      }
      
      for (const portfolio of portfolios || []) {
        const portfolioId = portfolio.id;
        
        // Get positions for this portfolio
        const { data: positions, error: positionsError } = await supabase
          .from('positions')
          .select('*')
          .eq('portfolio_id', portfolioId);
        
        if (positionsError) {
          console.error(`Error fetching positions for portfolio ${portfolioId}:`, positionsError);
          continue;
        }
        
        // Get underlying prices from underlying_mappings + fetch current prices
        // For simplicity, we'll use the current_price from stock positions as underlying prices
        const stockPositions = (positions || []).filter(p => p.asset_type === 'stock');
        const optionPositions = (positions || []).filter(p => p.asset_type === 'option');
        
        // Build underlying price map from stock positions
        const underlyingPrices: Record<string, number> = {};
        stockPositions.forEach(stock => {
          const key = normalizeForMatching(stock.description || '');
          if (stock.current_price && stock.current_price > 0) {
            underlyingPrices[key] = stock.current_price;
          }
        });
        
        // Get alert states for this portfolio
        const { data: alertStates, error: statesError } = await supabase
          .from('alert_states')
          .select('*')
          .eq('user_id', userId)
          .eq('portfolio_id', portfolioId);
        
        if (statesError) {
          console.error(`Error fetching alert states:`, statesError);
          continue;
        }
        
        const statesMap = new Map<string, AlertState>();
        (alertStates || []).forEach(s => {
          const key = `${s.position_key}:${s.alert_type}`;
          statesMap.set(key, s);
        });
        
        // Process options for distance alerts
        for (const option of optionPositions) {
          const ticker = getTicker(option);
          const strikePrice = option.strike_price || 0;
          const optionType = option.option_type;
          const quantity = option.quantity;
          const underlying = option.underlying || option.description?.split(' ')[0] || '';
          const underlyingKey = normalizeForMatching(underlying);
          const underlyingPrice = underlyingPrices[underlyingKey] || 0;
          
          if (underlyingPrice <= 0 || strikePrice <= 0) continue;
          
          // Only process sold options (quantity < 0)
          if (quantity >= 0) continue;
          
          const positionKey = `${option.id}`;
          
          // Determine alert type based on option type
          let alertType: string;
          let distancePct: number;
          let direction: 'up' | 'down';
          
          if (optionType === 'call') {
            alertType = ALERT_TYPES.DISTANCE_COVERED_CALL;
            distancePct = calcCallDistance(underlyingPrice, strikePrice);
            direction = 'up';
          } else if (optionType === 'put') {
            alertType = ALERT_TYPES.DISTANCE_NAKED_PUT;
            distancePct = calcPutDistance(underlyingPrice, strikePrice);
            direction = 'down';
          } else {
            continue;
          }
          
          const config = getEffectiveConfig(configs || [], alertType, ticker);
          if (!config.enabled) continue;
          
          const isInDanger = distancePct < config.threshold_pct;
          const stateKey = `${positionKey}:${alertType}`;
          const currentState = statesMap.get(stateKey);
          
          if (isInDanger && (!currentState || currentState.current_state === 'safe')) {
            // Crossing from safe to danger!
            if (cooldownPassed(currentState?.last_alerted_at || null, config.cooldown_minutes)) {
              // Create alert
              const strategyType = optionType === 'call' ? 'CC' : 'NP';
              const message = `${ticker} si avvicina allo strike $${strikePrice} (distanza ${distancePct.toFixed(1)}%)`;
              
              const { error: alertError } = await supabase
                .from('alerts')
                .insert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  alert_type: alertType,
                  ticker: ticker,
                  strategy_type: strategyType,
                  direction: direction,
                  current_value: distancePct,
                  threshold_value: config.threshold_pct,
                  strike_price: strikePrice,
                  underlying_price: underlyingPrice,
                  message: message,
                  severity: distancePct < config.threshold_pct / 2 ? 'critical' : 'warning',
                });
              
              if (alertError) {
                console.error('Error creating alert:', alertError);
              } else {
                totalAlertsCreated++;
                console.log(`Created alert: ${message}`);
              }
              
              // Update or insert state
              const { error: upsertError } = await supabase
                .from('alert_states')
                .upsert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  position_key: positionKey,
                  alert_type: alertType,
                  current_state: 'alerted',
                  last_alerted_at: new Date().toISOString(),
                }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
              
              if (upsertError) {
                console.error('Error updating state:', upsertError);
              }
            }
          } else if (!isInDanger && currentState?.current_state === 'alerted') {
            // Returned to safe zone - reset state
            const { error: updateError } = await supabase
              .from('alert_states')
              .update({ current_state: 'safe' })
              .eq('id', currentState.id);
            
            if (updateError) {
              console.error('Error resetting state:', updateError);
            }
          }
        }
        
        // === ACTION ALERTS ===
        
        // Check Naked Put ITM
        const npItmConfig = getEffectiveConfig(configs || [], ALERT_TYPES.ACTION_NAKED_PUT_ITM);
        if (npItmConfig.enabled) {
          for (const option of optionPositions) {
            if (option.option_type !== 'put' || option.quantity >= 0) continue;
            
            const ticker = getTicker(option);
            const strikePrice = option.strike_price || 0;
            const underlying = option.underlying || option.description?.split(' ')[0] || '';
            const underlyingKey = normalizeForMatching(underlying);
            const underlyingPrice = underlyingPrices[underlyingKey] || 0;
            
            if (underlyingPrice <= 0 || strikePrice <= 0) continue;
            
            const isITM = strikePrice > underlyingPrice;
            const positionKey = `np_itm_${option.id}`;
            const stateKey = `${positionKey}:${ALERT_TYPES.ACTION_NAKED_PUT_ITM}`;
            const currentState = statesMap.get(stateKey);
            
            if (isITM && (!currentState || currentState.current_state === 'safe')) {
              if (cooldownPassed(currentState?.last_alerted_at || null, npItmConfig.cooldown_minutes)) {
                const message = `Naked Put ${ticker} $${strikePrice} è ITM (sottostante a $${underlyingPrice.toFixed(2)})`;
                
                await supabase.from('alerts').insert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  alert_type: ALERT_TYPES.ACTION_NAKED_PUT_ITM,
                  ticker: ticker,
                  strategy_type: 'NP',
                  direction: 'down',
                  current_value: underlyingPrice,
                  threshold_value: strikePrice,
                  strike_price: strikePrice,
                  underlying_price: underlyingPrice,
                  message: message,
                  severity: 'critical',
                });
                totalAlertsCreated++;
                
                await supabase.from('alert_states').upsert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  position_key: positionKey,
                  alert_type: ALERT_TYPES.ACTION_NAKED_PUT_ITM,
                  current_state: 'alerted',
                  last_alerted_at: new Date().toISOString(),
                }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
              }
            } else if (!isITM && currentState?.current_state === 'alerted') {
              await supabase.from('alert_states')
                .update({ current_state: 'safe' })
                .eq('id', currentState.id);
            }
          }
        }
        
        // Check Covered Call ITM
        const ccItmConfig = getEffectiveConfig(configs || [], ALERT_TYPES.ACTION_COVERED_CALL_ITM);
        if (ccItmConfig.enabled) {
          for (const option of optionPositions) {
            if (option.option_type !== 'call' || option.quantity >= 0) continue;
            
            const ticker = getTicker(option);
            const strikePrice = option.strike_price || 0;
            const underlying = option.underlying || option.description?.split(' ')[0] || '';
            const underlyingKey = normalizeForMatching(underlying);
            const underlyingPrice = underlyingPrices[underlyingKey] || 0;
            
            if (underlyingPrice <= 0 || strikePrice <= 0) continue;
            
            const isITM = underlyingPrice > strikePrice;
            const positionKey = `cc_itm_${option.id}`;
            const stateKey = `${positionKey}:${ALERT_TYPES.ACTION_COVERED_CALL_ITM}`;
            const currentState = statesMap.get(stateKey);
            
            if (isITM && (!currentState || currentState.current_state === 'safe')) {
              if (cooldownPassed(currentState?.last_alerted_at || null, ccItmConfig.cooldown_minutes)) {
                const message = `Covered Call ${ticker} $${strikePrice} è ITM (sottostante a $${underlyingPrice.toFixed(2)})`;
                
                await supabase.from('alerts').insert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  alert_type: ALERT_TYPES.ACTION_COVERED_CALL_ITM,
                  ticker: ticker,
                  strategy_type: 'CC',
                  direction: 'up',
                  current_value: underlyingPrice,
                  threshold_value: strikePrice,
                  strike_price: strikePrice,
                  underlying_price: underlyingPrice,
                  message: message,
                  severity: 'warning',
                });
                totalAlertsCreated++;
                
                await supabase.from('alert_states').upsert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  position_key: positionKey,
                  alert_type: ALERT_TYPES.ACTION_COVERED_CALL_ITM,
                  current_state: 'alerted',
                  last_alerted_at: new Date().toISOString(),
                }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
              }
            } else if (!isITM && currentState?.current_state === 'alerted') {
              await supabase.from('alert_states')
                .update({ current_state: 'safe' })
                .eq('id', currentState.id);
            }
          }
        }
        
        // Check LEAP gains
        const leapGainConfigs = [
          { type: ALERT_TYPES.ACTION_LEAP_GAIN_20, threshold: 1.20 },
          { type: ALERT_TYPES.ACTION_LEAP_GAIN_30, threshold: 1.30 },
          { type: ALERT_TYPES.ACTION_LEAP_GAIN_40, threshold: 1.40 },
          { type: ALERT_TYPES.ACTION_LEAP_GAIN_50, threshold: 1.50 },
        ];
        
        for (const leapConfig of leapGainConfigs) {
          const config = getEffectiveConfig(configs || [], leapConfig.type);
          if (!config.enabled) continue;
          
          // Find LEAP calls (bought calls with expiry > 1 year)
          const leapCalls = optionPositions.filter(o => {
            if (o.option_type !== 'call' || o.quantity <= 0) return false;
            if (!o.expiry_date) return false;
            const expiry = new Date(o.expiry_date);
            const now = new Date();
            const daysDiff = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
            return daysDiff > 180; // At least 6 months out
          });
          
          for (const leap of leapCalls) {
            const ticker = getTicker(leap);
            const currentPrice = leap.current_price || 0;
            const avgCost = leap.avg_cost || 0;
            
            if (avgCost <= 0) continue;
            
            const gainPct = ((currentPrice - avgCost) / avgCost) * 100;
            const isAboveThreshold = currentPrice >= avgCost * leapConfig.threshold;
            const positionKey = `leap_${leapConfig.type}_${leap.id}`;
            const stateKey = `${positionKey}:${leapConfig.type}`;
            const currentState = statesMap.get(stateKey);
            
            if (isAboveThreshold && (!currentState || currentState.current_state === 'safe')) {
              if (cooldownPassed(currentState?.last_alerted_at || null, config.cooldown_minutes)) {
                const thresholdLabel = `+${Math.round((leapConfig.threshold - 1) * 100)}%`;
                const message = `LEAP ${ticker} ha raggiunto ${thresholdLabel} di guadagno (${gainPct.toFixed(1)}%)`;
                
                await supabase.from('alerts').insert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  alert_type: leapConfig.type,
                  ticker: ticker,
                  strategy_type: 'LEAP',
                  direction: null,
                  current_value: gainPct,
                  threshold_value: (leapConfig.threshold - 1) * 100,
                  strike_price: leap.strike_price,
                  underlying_price: null,
                  message: message,
                  severity: 'info',
                });
                totalAlertsCreated++;
                
                await supabase.from('alert_states').upsert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  position_key: positionKey,
                  alert_type: leapConfig.type,
                  current_state: 'alerted',
                  last_alerted_at: new Date().toISOString(),
                }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
              }
            } else if (!isAboveThreshold && currentState?.current_state === 'alerted') {
              await supabase.from('alert_states')
                .update({ current_state: 'safe' })
                .eq('id', currentState.id);
            }
          }
        }
      }
      
      // === PRICE ALERTS ===
      // Check custom price alerts for this user (not portfolio-specific)
      const { data: priceAlertsData, error: priceAlertsError } = await supabase
        .from('price_alerts')
        .select('*')
        .eq('user_id', userId)
        .eq('enabled', true);
      
      if (priceAlertsError) {
        console.error(`Error fetching price alerts for user ${userId}:`, priceAlertsError);
      } else if (priceAlertsData && priceAlertsData.length > 0) {
        // Get underlying_prices for all tickers in price alerts
        const priceAlertTickers = [...new Set(priceAlertsData.map(pa => pa.ticker))];
        
        const { data: tickerPrices, error: tickerPricesError } = await supabase
          .from('underlying_prices')
          .select('ticker, price')
          .in('ticker', priceAlertTickers);
        
        if (tickerPricesError) {
          console.error('Error fetching underlying prices:', tickerPricesError);
        } else {
          const priceMap = new Map<string, number>();
          (tickerPrices || []).forEach(tp => priceMap.set(tp.ticker, tp.price));
          
          for (const priceAlert of priceAlertsData) {
            const currentPrice = priceMap.get(priceAlert.ticker);
            if (!currentPrice) continue;
            
            const isTriggered = priceAlert.direction === 'above'
              ? currentPrice >= priceAlert.target_price
              : currentPrice <= priceAlert.target_price;
            
            const alertType = priceAlert.direction === 'above' 
              ? ALERT_TYPES.PRICE_ALERT_ABOVE 
              : ALERT_TYPES.PRICE_ALERT_BELOW;
            
            // Use price_alert id as position key for state tracking
            const positionKey = `price_alert_${priceAlert.id}`;
            const stateKey = `${positionKey}:${alertType}`;
            
            // Get state for this specific price alert
            const { data: stateData } = await supabase
              .from('alert_states')
              .select('*')
              .eq('user_id', userId)
              .eq('position_key', positionKey)
              .eq('alert_type', alertType)
              .maybeSingle();
            
            const currentState = stateData as AlertState | null;
            
            if (isTriggered && (!currentState || currentState.current_state === 'safe')) {
              // Check cooldown
              if (cooldownPassed(currentState?.last_alerted_at || priceAlert.last_triggered_at, priceAlert.cooldown_minutes)) {
                const direction = priceAlert.direction === 'above' ? 'salito sopra' : 'sceso sotto';
                const message = `${priceAlert.ticker} è ${direction} $${priceAlert.target_price.toFixed(2)} (prezzo attuale: $${currentPrice.toFixed(2)})`;
                
                // Create alert
                const { error: alertError } = await supabase
                  .from('alerts')
                  .insert({
                    user_id: userId,
                    portfolio_id: null, // Price alerts are not portfolio-specific
                    alert_type: alertType,
                    ticker: priceAlert.ticker,
                    strategy_type: 'PRICE',
                    direction: priceAlert.direction === 'above' ? 'up' : 'down',
                    current_value: currentPrice,
                    threshold_value: priceAlert.target_price,
                    strike_price: null,
                    underlying_price: currentPrice,
                    message: message,
                    severity: 'info',
                  });
                
                if (alertError) {
                  console.error('Error creating price alert:', alertError);
                } else {
                  totalAlertsCreated++;
                  console.log(`Created price alert: ${message}`);
                }
                
                // Update alert state
                await supabase.from('alert_states').upsert({
                  user_id: userId,
                  portfolio_id: null,
                  position_key: positionKey,
                  alert_type: alertType,
                  current_state: 'alerted',
                  last_alerted_at: new Date().toISOString(),
                }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
                
                // Update last_triggered_at on price_alert itself
                await supabase
                  .from('price_alerts')
                  .update({ last_triggered_at: new Date().toISOString() })
                  .eq('id', priceAlert.id);
              }
            } else if (!isTriggered && currentState?.current_state === 'alerted') {
              // Reset state when condition is no longer met
              await supabase.from('alert_states')
                .update({ current_state: 'safe' })
                .eq('id', currentState.id);
            }
          }
        }
      }
    }
    
    console.log(`Check-alerts completed. Created ${totalAlertsCreated} alerts.`);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        alertsCreated: totalAlertsCreated,
        usersProcessed: uniqueUserIds.length 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error in check-alerts:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
