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

const DEFAULT_THRESHOLD_PCT = 2;
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

interface StrategyCache {
  id: string;
  portfolio_id: string;
  strategy_key: string;
  strategy_type: string;
  underlying: string;
  ticker: string | null;
  position_ids: string[];
  sold_put_strike: number | null;
  sold_call_strike: number | null;
  bought_put_strike: number | null;
  bought_call_strike: number | null;
  is_range_strategy: boolean;
  sold_call_expiry: string | null;
  sold_put_expiry: string | null;
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
  market_value: number | null;
}

// ============ HELPER FUNCTIONS ============

function getEffectiveConfig(
  configs: AlertConfig[],
  alertType: string,
  ticker?: string
): { threshold_pct: number; cooldown_minutes: number; enabled: boolean } {
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

function cooldownPassed(lastAlertedAt: string | null, cooldownMinutes: number): boolean {
  if (!lastAlertedAt) return true;
  const lastAlerted = new Date(lastAlertedAt);
  const now = new Date();
  const diffMs = now.getTime() - lastAlerted.getTime();
  const diffMinutes = diffMs / (1000 * 60);
  return diffMinutes >= cooldownMinutes;
}

function calcCallDistance(underlyingPrice: number, strikePrice: number): number {
  if (underlyingPrice <= 0) return 100;
  return ((strikePrice - underlyingPrice) / underlyingPrice) * 100;
}

function calcPutDistance(underlyingPrice: number, strikePrice: number): number {
  if (underlyingPrice <= 0) return 100;
  return ((underlyingPrice - strikePrice) / underlyingPrice) * 100;
}

function normalizeForMatching(text: string): string {
  return text
    .toUpperCase()
    .replace(/^AZ\./i, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\b(INC|CORP|CORPORATION|LTD|LIMITED|CLASS\s*[A-Z]?|COMMON|STOCK|DEL|OHIO|CA|THE|ADR|SPA|AG|SA|NV|PLC)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Calculate breakeven points for a strategy
function calculateBreakevens(positions: Position[]): number[] {
  if (positions.length === 0) return [];
  
  const strikes = positions.map(o => o.strike_price || 0).filter(s => s > 0);
  if (strikes.length === 0) return [];
  
  const minStrike = Math.min(...strikes);
  const maxStrike = Math.max(...strikes);
  const range = maxStrike - minStrike;
  const padding = Math.max(range * 0.5, minStrike * 0.3);
  
  const testMin = Math.max(0, minStrike - padding);
  const testMax = maxStrike + padding;
  const step = (testMax - testMin) / 100;
  
  const payoffs: { price: number; payoff: number }[] = [];
  
  for (let i = 0; i <= 100; i++) {
    const price = testMin + i * step;
    let totalPayoff = 0;
    
    for (const o of positions) {
      const strike = o.strike_price || 0;
      const premium = Math.abs(o.avg_cost || o.current_price || 0) * 100;
      const isLong = o.quantity > 0;
      const qty = Math.abs(o.quantity);
      
      let intrinsic = 0;
      if (o.option_type === 'call') {
        intrinsic = Math.max(0, price - strike) * 100;
      } else {
        intrinsic = Math.max(0, strike - price) * 100;
      }
      
      if (isLong) {
        totalPayoff += (intrinsic - premium) * qty;
      } else {
        totalPayoff += (premium - intrinsic) * qty;
      }
    }
    
    payoffs.push({ price, payoff: totalPayoff });
  }
  
  // Find zero crossings
  const breakevens: number[] = [];
  for (let i = 1; i < payoffs.length; i++) {
    const prev = payoffs[i - 1];
    const curr = payoffs[i];
    
    if ((prev.payoff <= 0 && curr.payoff >= 0) || (prev.payoff >= 0 && curr.payoff <= 0)) {
      const ratio = Math.abs(prev.payoff) / (Math.abs(prev.payoff) + Math.abs(curr.payoff));
      const breakeven = prev.price + ratio * (curr.price - prev.price);
      breakevens.push(breakeven);
    }
  }
  
  return breakevens;
}

function isOutOfBreakeven(underlyingPrice: number, breakevens: number[]): boolean {
  if (breakevens.length === 0) return false;
  if (breakevens.length === 1) return false;
  
  const minBE = Math.min(...breakevens);
  const maxBE = Math.max(...breakevens);
  
  return underlyingPrice < minBE || underlyingPrice > maxBE;
}

function isUSMarketOpen(): boolean {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  const year = now.getUTCFullYear();
  // Second Sunday of March: DST starts at 2:00 AM ET = 7:00 UTC
  const marchFirst = new Date(Date.UTC(year, 2, 1));
  const marchSecondSunday = 14 - marchFirst.getUTCDay();
  const dstStart = new Date(Date.UTC(year, 2, marchSecondSunday, 7));

  // First Sunday of November: DST ends at 2:00 AM EDT = 6:00 UTC
  const novFirst = new Date(Date.UTC(year, 10, 1));
  const novFirstSunday = novFirst.getUTCDay() === 0 ? 1 : 8 - novFirst.getUTCDay();
  const dstEnd = new Date(Date.UTC(year, 10, novFirstSunday, 6));

  const isDST = now >= dstStart && now < dstEnd;
  const etOffset = isDST ? -4 : -5;

  // Current time in Eastern Time (minutes since midnight)
  const etHour = now.getUTCHours() + etOffset;
  const etMinutes = now.getUTCMinutes();
  const etTime = etHour * 60 + etMinutes;

  // NYSE: 9:30 - 16:00 ET → 570 - 960 minutes
  return etTime >= 570 && etTime < 960;
}

function mapStrategyTypeToCategory(strategyType: string): string {
  switch (strategyType) {
    case 'Naked Put': return 'naked_put';
    case 'Covered Call': return 'covered_call';
    case 'LEAP Call': return 'leap_call';
    default: return 'other';
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Check if US market is currently open (exact ET hours with DST awareness)
    if (!isUSMarketOpen()) {
      console.log('US market is closed, skipping alert check');
      return new Response(JSON.stringify({ skipped: true, reason: 'market_closed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    
    console.log('Starting check-alerts cron job (cache-based)...');
    
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
        
        // ============ GET STRATEGY CACHE ============
        const { data: strategiesCache, error: cacheError } = await supabase
          .from('strategy_cache')
          .select('*')
          .eq('portfolio_id', portfolioId);
        
        if (cacheError) {
          console.error(`Error fetching strategy cache for portfolio ${portfolioId}:`, cacheError);
          continue;
        }
        
        if (!strategiesCache || strategiesCache.length === 0) {
          console.log(`No strategy cache for portfolio ${portfolioId} - user hasn't visited Derivatives page`);
          continue;
        }
        
        const strategies: StrategyCache[] = strategiesCache;
        
        // ============ FETCH DERIVATIVE OVERRIDES ============
        const { data: overridesData } = await supabase
          .from('derivative_overrides')
          .select('position_id, target_category, override_type')
          .eq('portfolio_id', portfolioId);
        
        const overriddenPositions = new Map<string, string>();
        for (const ov of (overridesData || [])) {
          if (ov.override_type === 'single' && ov.position_id) {
            overriddenPositions.set(ov.position_id, ov.target_category || 'other');
          }
        }
        
        if (overriddenPositions.size > 0) {
          console.log(`[${portfolioId}] Found ${overriddenPositions.size} position overrides`);
        }
        
        // ============ FETCH STRATEGY ALERT TOGGLES ============
        const { data: strategyTogglesData } = await supabase
          .from('strategy_alert_toggles')
          .select('strategy_key, enabled')
          .eq('user_id', userId)
          .eq('enabled', false);
        
        const disabledStrategyKeys = new Set<string>(
          (strategyTogglesData || []).map((t: any) => t.strategy_key)
        );
        
        // Filter out disabled strategies
        const activeStrategies = strategies.filter(s => !disabledStrategyKeys.has(s.strategy_key));
        
        if (activeStrategies.length < strategies.length) {
          console.log(`[${portfolioId}] Filtered ${strategies.length - activeStrategies.length} disabled strategies`);
        }
        
        // Build set of position IDs used in strategies
        const usedPositionIds = new Set<string>();
        for (const s of activeStrategies) {
          for (const posId of s.position_ids) {
            usedPositionIds.add(posId);
          }
        }
        
        console.log(`[${portfolioId}] Loaded ${activeStrategies.length}/${strategies.length} active strategies from cache`);
        
        // Get positions for this portfolio (for LEAP gain calculations)
        const { data: positions, error: positionsError } = await supabase
          .from('positions')
          .select('*')
          .eq('portfolio_id', portfolioId);
        
        if (positionsError) {
          console.error(`Error fetching positions for portfolio ${portfolioId}:`, positionsError);
          continue;
        }
        
        // Get underlying prices from database
        const allTickers = [...new Set(activeStrategies.map(s => s.ticker).filter(Boolean) as string[])];
        const underlyingPrices: Record<string, number> = {};
        
        if (allTickers.length > 0) {
          const { data: pricesData } = await supabase
            .from('underlying_prices')
            .select('ticker, price')
            .in('ticker', allTickers);
          
          if (pricesData) {
            for (const p of pricesData) {
              underlyingPrices[p.ticker] = p.price;
            }
          }
        }
        
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
        
        // ============ PROCESS STRATEGIES FROM CACHE ============
        for (const strategy of activeStrategies) {
          const ticker = strategy.ticker || 'N/A';
          const underlyingPrice = strategy.ticker ? (underlyingPrices[strategy.ticker] || 0) : 0;
          const strategyType = strategy.strategy_type;
          
          // Check if any position in this strategy has been overridden to a different category
          const hasOverride = strategy.position_ids.some(pid => {
            const overrideCategory = overriddenPositions.get(pid);
            if (!overrideCategory) return false;
            const expectedCategory = mapStrategyTypeToCategory(strategyType);
            return overrideCategory !== expectedCategory;
          });
          
          if (hasOverride) {
            console.log(`[${portfolioId}] Skipping ${strategyType} ${ticker} - position overridden`);
            continue;
          }
          
          if (underlyingPrice <= 0) {
            console.log(`No price for ${ticker} (${strategyType})`);
            continue;
          }
          
          // ============ COVERED CALL ============
          if (strategyType === 'Covered Call') {
            const soldCallStrike = strategy.sold_call_strike || 0;
            if (soldCallStrike <= 0) continue;
            
            // Calculate ITM state FIRST
            const isITM = underlyingPrice > soldCallStrike;
            
            // ITM Alert
            const itmConfig = getEffectiveConfig(configs || [], ALERT_TYPES.ACTION_COVERED_CALL_ITM, ticker);
            if (itmConfig.enabled) {
              const positionKey = `cc_itm_${strategy.strategy_key}`;
              const stateKey = `${positionKey}:${ALERT_TYPES.ACTION_COVERED_CALL_ITM}`;
              const currentState = statesMap.get(stateKey);
              
              if (isITM && (!currentState || currentState.current_state === 'safe')) {
                if (cooldownPassed(currentState?.last_alerted_at || null, itmConfig.cooldown_minutes)) {
                  const message = `La Covered Call è ITM`;
                  
                  await supabase.from('alerts').insert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    alert_type: ALERT_TYPES.ACTION_COVERED_CALL_ITM,
                    ticker,
                    strategy_type: 'Covered Call',
                    direction: 'up',
                    current_value: underlyingPrice,
                    threshold_value: soldCallStrike,
                    strike_price: soldCallStrike,
                    underlying_price: underlyingPrice,
                    message,
                    severity: 'critical',
                    option_type: 'call',
                    option_expiry: strategy.sold_call_expiry,
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
                
                // Pre-set distance state to 'alerted' to suppress spurious alert
                // during recovery from ITM side
                const distPositionKey = `cc_dist_${strategy.strategy_key}`;
                await supabase.from('alert_states').upsert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  position_key: distPositionKey,
                  alert_type: ALERT_TYPES.DISTANCE_COVERED_CALL,
                  current_state: 'alerted',
                  last_alerted_at: new Date().toISOString(),
                }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
              }
            }
            
            // Distance Alert - SUPPRESSED if already ITM
            const distConfig = getEffectiveConfig(configs || [], ALERT_TYPES.DISTANCE_COVERED_CALL, ticker);
            if (distConfig.enabled && !isITM) {
              const distancePct = calcCallDistance(underlyingPrice, soldCallStrike);
              const isInDanger = distancePct < distConfig.threshold_pct;
              const positionKey = `cc_dist_${strategy.strategy_key}`;
              const stateKey = `${positionKey}:${ALERT_TYPES.DISTANCE_COVERED_CALL}`;
              const currentState = statesMap.get(stateKey);
              
              if (isInDanger && (!currentState || currentState.current_state === 'safe')) {
                if (cooldownPassed(currentState?.last_alerted_at || null, distConfig.cooldown_minutes)) {
                  const message = `${ticker} si avvicina allo strike della call venduta`;
                  
                  await supabase.from('alerts').insert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    alert_type: ALERT_TYPES.DISTANCE_COVERED_CALL,
                    ticker,
                    strategy_type: 'Covered Call',
                    direction: 'up',
                    current_value: distancePct,
                    threshold_value: distConfig.threshold_pct,
                    strike_price: soldCallStrike,
                    underlying_price: underlyingPrice,
                    message,
                    severity: 'warning',
                    option_type: 'call',
                    option_expiry: strategy.sold_call_expiry,
                  });
                  totalAlertsCreated++;
                  
                  await supabase.from('alert_states').upsert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    position_key: positionKey,
                    alert_type: ALERT_TYPES.DISTANCE_COVERED_CALL,
                    current_state: 'alerted',
                    last_alerted_at: new Date().toISOString(),
                  }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
                }
              } else if (!isInDanger && currentState?.current_state === 'alerted') {
                await supabase.from('alert_states')
                  .update({ current_state: 'safe' })
                  .eq('id', currentState.id);
              }
            }
          }
          
          // ============ NAKED PUT ============
          if (strategyType === 'Naked Put') {
            const soldPutStrike = strategy.sold_put_strike || 0;
            if (soldPutStrike <= 0) continue;
            
            // Calculate ITM state FIRST
            const isITM = underlyingPrice < soldPutStrike;
            
            // ITM Alert
            const itmConfig = getEffectiveConfig(configs || [], ALERT_TYPES.ACTION_NAKED_PUT_ITM, ticker);
            if (itmConfig.enabled) {
              const positionKey = `np_itm_${strategy.strategy_key}`;
              const stateKey = `${positionKey}:${ALERT_TYPES.ACTION_NAKED_PUT_ITM}`;
              const currentState = statesMap.get(stateKey);
              
              if (isITM && (!currentState || currentState.current_state === 'safe')) {
                if (cooldownPassed(currentState?.last_alerted_at || null, itmConfig.cooldown_minutes)) {
                  const message = `La Naked Put è ITM`;
                  
                  await supabase.from('alerts').insert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    alert_type: ALERT_TYPES.ACTION_NAKED_PUT_ITM,
                    ticker,
                    strategy_type: 'Naked Put',
                    direction: 'down',
                    current_value: underlyingPrice,
                    threshold_value: soldPutStrike,
                    strike_price: soldPutStrike,
                    underlying_price: underlyingPrice,
                    message,
                    severity: 'critical',
                    option_type: 'put',
                    option_expiry: strategy.sold_put_expiry,
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
                
                // Pre-set distance state to 'alerted' to suppress spurious alert
                // during recovery from ITM side
                const distPositionKey = `np_dist_${strategy.strategy_key}`;
                await supabase.from('alert_states').upsert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  position_key: distPositionKey,
                  alert_type: ALERT_TYPES.DISTANCE_NAKED_PUT,
                  current_state: 'alerted',
                  last_alerted_at: new Date().toISOString(),
                }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
              }
            }
            
            // Distance Alert - SUPPRESSED if already ITM
            const distConfig = getEffectiveConfig(configs || [], ALERT_TYPES.DISTANCE_NAKED_PUT, ticker);
            if (distConfig.enabled && !isITM) {
              const distancePct = calcPutDistance(underlyingPrice, soldPutStrike);
              const isInDanger = distancePct < distConfig.threshold_pct;
              const positionKey = `np_dist_${strategy.strategy_key}`;
              const stateKey = `${positionKey}:${ALERT_TYPES.DISTANCE_NAKED_PUT}`;
              const currentState = statesMap.get(stateKey);
              
              if (isInDanger && (!currentState || currentState.current_state === 'safe')) {
                if (cooldownPassed(currentState?.last_alerted_at || null, distConfig.cooldown_minutes)) {
                  const message = `${ticker} si avvicina allo strike della put venduta`;
                  
                  await supabase.from('alerts').insert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    alert_type: ALERT_TYPES.DISTANCE_NAKED_PUT,
                    ticker,
                    strategy_type: 'Naked Put',
                    direction: 'down',
                    current_value: distancePct,
                    threshold_value: distConfig.threshold_pct,
                    strike_price: soldPutStrike,
                    underlying_price: underlyingPrice,
                    message,
                    severity: 'warning',
                    option_type: 'put',
                    option_expiry: strategy.sold_put_expiry,
                  });
                  totalAlertsCreated++;
                  
                  await supabase.from('alert_states').upsert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    position_key: positionKey,
                    alert_type: ALERT_TYPES.DISTANCE_NAKED_PUT,
                    current_state: 'alerted',
                    last_alerted_at: new Date().toISOString(),
                  }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
                }
              } else if (!isInDanger && currentState?.current_state === 'alerted') {
                await supabase.from('alert_states')
                  .update({ current_state: 'safe' })
                  .eq('id', currentState.id);
              }
            }
          }
          
          // ============ IRON CONDOR ============
          if (strategyType === 'Iron Condor') {
            const soldPutStrike = strategy.sold_put_strike || 0;
            const soldCallStrike = strategy.sold_call_strike || 0;
            if (soldPutStrike <= 0 || soldCallStrike <= 0) continue;
            
            // Calculate OOR state FIRST - distinguishing by side
            const isOOR_Put = underlyingPrice < soldPutStrike;
            const isOOR_Call = underlyingPrice > soldCallStrike;
            const isOOR = isOOR_Put || isOOR_Call;
            
            // OOR Alert
            const oorConfig = getEffectiveConfig(configs || [], ALERT_TYPES.ACTION_DD_IC_OOR, ticker);
            if (oorConfig.enabled) {
              const positionKey = `ic_oor_${strategy.strategy_key}`;
              const stateKey = `${positionKey}:${ALERT_TYPES.ACTION_DD_IC_OOR}`;
              const currentState = statesMap.get(stateKey);
              
              if (isOOR && (!currentState || currentState.current_state === 'safe')) {
                if (cooldownPassed(currentState?.last_alerted_at || null, oorConfig.cooldown_minutes)) {
                  const side = isOOR_Put ? 'PUT' : 'CALL';
                  const message = `La strategia è OOR (fuori dal range venduto)`;
                  
                  await supabase.from('alerts').insert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    alert_type: ALERT_TYPES.ACTION_DD_IC_OOR,
                    ticker,
                    strategy_type: 'Iron Condor',
                    direction: side === 'PUT' ? 'down' : 'up',
                    current_value: underlyingPrice,
                    threshold_value: side === 'PUT' ? soldPutStrike : soldCallStrike,
                    strike_price: side === 'PUT' ? soldPutStrike : soldCallStrike,
                    underlying_price: underlyingPrice,
                    message,
                    severity: 'critical',
                    option_type: side === 'PUT' ? 'put' : 'call',
                    option_expiry: side === 'PUT' ? strategy.sold_put_expiry : strategy.sold_call_expiry,
                  });
                  totalAlertsCreated++;
                  
                  await supabase.from('alert_states').upsert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    position_key: positionKey,
                    alert_type: ALERT_TYPES.ACTION_DD_IC_OOR,
                    current_state: 'alerted',
                    last_alerted_at: new Date().toISOString(),
                  }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
                }
              } else if (!isOOR && currentState?.current_state === 'alerted') {
                await supabase.from('alert_states')
                  .update({ current_state: 'safe' })
                  .eq('id', currentState.id);
                
                // Pre-set both distance states to 'alerted' to suppress spurious alerts
                // during recovery from OOR
                const icPutDistKey = `ic_put_dist_${strategy.strategy_key}`;
                await supabase.from('alert_states').upsert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  position_key: icPutDistKey,
                  alert_type: ALERT_TYPES.DISTANCE_IRON_CONDOR_PUT,
                  current_state: 'alerted',
                  last_alerted_at: new Date().toISOString(),
                }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
                
                const icCallDistKey = `ic_call_dist_${strategy.strategy_key}`;
                await supabase.from('alert_states').upsert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  position_key: icCallDistKey,
                  alert_type: ALERT_TYPES.DISTANCE_IRON_CONDOR_CALL,
                  current_state: 'alerted',
                  last_alerted_at: new Date().toISOString(),
                }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
              }
            }
            
            // Distance alerts for IC PUT - SUPPRESSED if already OOR on PUT side
            const putDistConfig = getEffectiveConfig(configs || [], ALERT_TYPES.DISTANCE_IRON_CONDOR_PUT, ticker);
            if (putDistConfig.enabled && !isOOR_Put) {
              const distancePct = calcPutDistance(underlyingPrice, soldPutStrike);
              const isInDanger = distancePct < putDistConfig.threshold_pct;
              const positionKey = `ic_put_dist_${strategy.strategy_key}`;
              const stateKey = `${positionKey}:${ALERT_TYPES.DISTANCE_IRON_CONDOR_PUT}`;
              const currentState = statesMap.get(stateKey);
              
              if (isInDanger && (!currentState || currentState.current_state === 'safe')) {
                if (cooldownPassed(currentState?.last_alerted_at || null, putDistConfig.cooldown_minutes)) {
                  const message = `${ticker} si avvicina allo strike della put venduta`;
                  
                  await supabase.from('alerts').insert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    alert_type: ALERT_TYPES.DISTANCE_IRON_CONDOR_PUT,
                    ticker,
                    strategy_type: 'Iron Condor',
                    direction: 'down',
                    current_value: distancePct,
                    threshold_value: putDistConfig.threshold_pct,
                    strike_price: soldPutStrike,
                    underlying_price: underlyingPrice,
                    message,
                    severity: 'warning',
                    option_type: 'put',
                    option_expiry: strategy.sold_put_expiry,
                  });
                  totalAlertsCreated++;
                  
                  await supabase.from('alert_states').upsert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    position_key: positionKey,
                    alert_type: ALERT_TYPES.DISTANCE_IRON_CONDOR_PUT,
                    current_state: 'alerted',
                    last_alerted_at: new Date().toISOString(),
                  }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
                }
              } else if (!isInDanger && currentState?.current_state === 'alerted') {
                await supabase.from('alert_states')
                  .update({ current_state: 'safe' })
                  .eq('id', currentState.id);
              }
            }
            
            // Distance alerts for IC CALL - SUPPRESSED if already OOR on CALL side
            const callDistConfig = getEffectiveConfig(configs || [], ALERT_TYPES.DISTANCE_IRON_CONDOR_CALL, ticker);
            if (callDistConfig.enabled && !isOOR_Call) {
              const distancePct = calcCallDistance(underlyingPrice, soldCallStrike);
              const isInDanger = distancePct < callDistConfig.threshold_pct;
              const positionKey = `ic_call_dist_${strategy.strategy_key}`;
              const stateKey = `${positionKey}:${ALERT_TYPES.DISTANCE_IRON_CONDOR_CALL}`;
              const currentState = statesMap.get(stateKey);
              
              if (isInDanger && (!currentState || currentState.current_state === 'safe')) {
                if (cooldownPassed(currentState?.last_alerted_at || null, callDistConfig.cooldown_minutes)) {
                  const message = `${ticker} si avvicina allo strike della call venduta`;
                  
                  await supabase.from('alerts').insert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    alert_type: ALERT_TYPES.DISTANCE_IRON_CONDOR_CALL,
                    ticker,
                    strategy_type: 'Iron Condor',
                    direction: 'up',
                    current_value: distancePct,
                    threshold_value: callDistConfig.threshold_pct,
                    strike_price: soldCallStrike,
                    underlying_price: underlyingPrice,
                    message,
                    severity: 'warning',
                    option_type: 'call',
                    option_expiry: strategy.sold_call_expiry,
                  });
                  totalAlertsCreated++;
                  
                  await supabase.from('alert_states').upsert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    position_key: positionKey,
                    alert_type: ALERT_TYPES.DISTANCE_IRON_CONDOR_CALL,
                    current_state: 'alerted',
                    last_alerted_at: new Date().toISOString(),
                  }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
                }
              } else if (!isInDanger && currentState?.current_state === 'alerted') {
                await supabase.from('alert_states')
                  .update({ current_state: 'safe' })
                  .eq('id', currentState.id);
              }
            }
          }
          
          // ============ DOUBLE DIAGONAL ============
          if (strategyType === 'Double Diagonal') {
            const soldPutStrike = strategy.sold_put_strike || 0;
            const soldCallStrike = strategy.sold_call_strike || 0;
            if (soldPutStrike <= 0 || soldCallStrike <= 0) continue;
            
            // Calculate OOR state FIRST - distinguishing by side
            const isOOR_Put = underlyingPrice < soldPutStrike;
            const isOOR_Call = underlyingPrice > soldCallStrike;
            const isOOR = isOOR_Put || isOOR_Call;
            
            // OOR Alert
            const oorConfig = getEffectiveConfig(configs || [], ALERT_TYPES.ACTION_DD_IC_OOR, ticker);
            if (oorConfig.enabled) {
              const positionKey = `dd_oor_${strategy.strategy_key}`;
              const stateKey = `${positionKey}:${ALERT_TYPES.ACTION_DD_IC_OOR}`;
              const currentState = statesMap.get(stateKey);
              
              if (isOOR && (!currentState || currentState.current_state === 'safe')) {
                if (cooldownPassed(currentState?.last_alerted_at || null, oorConfig.cooldown_minutes)) {
                  const side = isOOR_Put ? 'PUT' : 'CALL';
                  const message = `La strategia è OOR (fuori dal range venduto)`;
                  
                  await supabase.from('alerts').insert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    alert_type: ALERT_TYPES.ACTION_DD_IC_OOR,
                    ticker,
                    strategy_type: 'Double Diagonal',
                    direction: side === 'PUT' ? 'down' : 'up',
                    current_value: underlyingPrice,
                    threshold_value: side === 'PUT' ? soldPutStrike : soldCallStrike,
                    strike_price: side === 'PUT' ? soldPutStrike : soldCallStrike,
                    underlying_price: underlyingPrice,
                    message,
                    severity: 'critical',
                    option_type: side === 'PUT' ? 'put' : 'call',
                    option_expiry: side === 'PUT' ? strategy.sold_put_expiry : strategy.sold_call_expiry,
                  });
                  totalAlertsCreated++;
                  
                  await supabase.from('alert_states').upsert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    position_key: positionKey,
                    alert_type: ALERT_TYPES.ACTION_DD_IC_OOR,
                    current_state: 'alerted',
                    last_alerted_at: new Date().toISOString(),
                  }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
                }
              } else if (!isOOR && currentState?.current_state === 'alerted') {
                await supabase.from('alert_states')
                  .update({ current_state: 'safe' })
                  .eq('id', currentState.id);
                
                // Pre-set both distance states to 'alerted' to suppress spurious alerts
                const ddPutDistKey = `dd_put_dist_${strategy.strategy_key}`;
                await supabase.from('alert_states').upsert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  position_key: ddPutDistKey,
                  alert_type: ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_PUT,
                  current_state: 'alerted',
                  last_alerted_at: new Date().toISOString(),
                }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
                
                const ddCallDistKey = `dd_call_dist_${strategy.strategy_key}`;
                await supabase.from('alert_states').upsert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  position_key: ddCallDistKey,
                  alert_type: ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_CALL,
                  current_state: 'alerted',
                  last_alerted_at: new Date().toISOString(),
                }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
              }
            }
            
            // Distance alerts for DD PUT - SUPPRESSED if already OOR on PUT side
            const putDistConfig = getEffectiveConfig(configs || [], ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_PUT, ticker);
            if (putDistConfig.enabled && !isOOR_Put) {
              const distancePct = calcPutDistance(underlyingPrice, soldPutStrike);
              const isInDanger = distancePct < putDistConfig.threshold_pct;
              const positionKey = `dd_put_dist_${strategy.strategy_key}`;
              const stateKey = `${positionKey}:${ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_PUT}`;
              const currentState = statesMap.get(stateKey);
              
              if (isInDanger && (!currentState || currentState.current_state === 'safe')) {
                if (cooldownPassed(currentState?.last_alerted_at || null, putDistConfig.cooldown_minutes)) {
                  const message = `${ticker} si avvicina allo strike della put venduta`;
                  
                  await supabase.from('alerts').insert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    alert_type: ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_PUT,
                    ticker,
                    strategy_type: 'Double Diagonal',
                    direction: 'down',
                    current_value: distancePct,
                    threshold_value: putDistConfig.threshold_pct,
                    strike_price: soldPutStrike,
                    underlying_price: underlyingPrice,
                    message,
                    severity: 'warning',
                    option_type: 'put',
                    option_expiry: strategy.sold_put_expiry,
                  });
                  totalAlertsCreated++;
                  
                  await supabase.from('alert_states').upsert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    position_key: positionKey,
                    alert_type: ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_PUT,
                    current_state: 'alerted',
                    last_alerted_at: new Date().toISOString(),
                  }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
                }
              } else if (!isInDanger && currentState?.current_state === 'alerted') {
                await supabase.from('alert_states')
                  .update({ current_state: 'safe' })
                  .eq('id', currentState.id);
              }
            }
            
            // Distance alerts for DD CALL - SUPPRESSED if already OOR on CALL side
            const callDistConfig = getEffectiveConfig(configs || [], ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_CALL, ticker);
            if (callDistConfig.enabled && !isOOR_Call) {
              const distancePct = calcCallDistance(underlyingPrice, soldCallStrike);
              const isInDanger = distancePct < callDistConfig.threshold_pct;
              const positionKey = `dd_call_dist_${strategy.strategy_key}`;
              const stateKey = `${positionKey}:${ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_CALL}`;
              const currentState = statesMap.get(stateKey);
              
              if (isInDanger && (!currentState || currentState.current_state === 'safe')) {
                if (cooldownPassed(currentState?.last_alerted_at || null, callDistConfig.cooldown_minutes)) {
                  const message = `${ticker} si avvicina allo strike della call venduta`;
                  
                  await supabase.from('alerts').insert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    alert_type: ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_CALL,
                    ticker,
                    strategy_type: 'Double Diagonal',
                    direction: 'up',
                    current_value: distancePct,
                    threshold_value: callDistConfig.threshold_pct,
                    strike_price: soldCallStrike,
                    underlying_price: underlyingPrice,
                    message,
                    severity: 'warning',
                    option_type: 'call',
                    option_expiry: strategy.sold_call_expiry,
                  });
                  totalAlertsCreated++;
                  
                  await supabase.from('alert_states').upsert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    position_key: positionKey,
                    alert_type: ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_CALL,
                    current_state: 'alerted',
                    last_alerted_at: new Date().toISOString(),
                  }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
                }
              } else if (!isInDanger && currentState?.current_state === 'alerted') {
                await supabase.from('alert_states')
                  .update({ current_state: 'safe' })
                  .eq('id', currentState.id);
              }
            }
          }
          
          // ============ ALTERNATIVE DOUBLE DIAGONAL (Range Strategy) ============
          if (strategyType === 'Alternative Double Diagonal' && strategy.is_range_strategy) {
            const soldPutStrike = strategy.sold_put_strike || 0;
            const soldCallStrike = strategy.sold_call_strike || 0;
            if (soldPutStrike <= 0 || soldCallStrike <= 0) continue;
            
            // Calculate OOR state FIRST - distinguishing by side
            const isOOR_Put = underlyingPrice < soldPutStrike;
            const isOOR_Call = underlyingPrice > soldCallStrike;
            const isOOR = isOOR_Put || isOOR_Call;
            
            // OOR Alert
            const oorConfig = getEffectiveConfig(configs || [], ALERT_TYPES.ACTION_DD_IC_OOR, ticker);
            if (oorConfig.enabled) {
              const positionKey = `altdd_oor_${strategy.strategy_key}`;
              const stateKey = `${positionKey}:${ALERT_TYPES.ACTION_DD_IC_OOR}`;
              const currentState = statesMap.get(stateKey);
              
              if (isOOR && (!currentState || currentState.current_state === 'safe')) {
                if (cooldownPassed(currentState?.last_alerted_at || null, oorConfig.cooldown_minutes)) {
                  const side = isOOR_Put ? 'PUT' : 'CALL';
                  const message = `La strategia è OOR (fuori dal range venduto)`;
                  
                  await supabase.from('alerts').insert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    alert_type: ALERT_TYPES.ACTION_DD_IC_OOR,
                    ticker,
                    strategy_type: 'Alternative Double Diagonal',
                    direction: side === 'PUT' ? 'down' : 'up',
                    current_value: underlyingPrice,
                    threshold_value: side === 'PUT' ? soldPutStrike : soldCallStrike,
                    strike_price: side === 'PUT' ? soldPutStrike : soldCallStrike,
                    underlying_price: underlyingPrice,
                    message,
                    severity: 'critical',
                    option_type: side === 'PUT' ? 'put' : 'call',
                    option_expiry: side === 'PUT' ? strategy.sold_put_expiry : strategy.sold_call_expiry,
                  });
                  totalAlertsCreated++;
                  
                  await supabase.from('alert_states').upsert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    position_key: positionKey,
                    alert_type: ALERT_TYPES.ACTION_DD_IC_OOR,
                    current_state: 'alerted',
                    last_alerted_at: new Date().toISOString(),
                  }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
                }
              } else if (!isOOR && currentState?.current_state === 'alerted') {
                await supabase.from('alert_states')
                  .update({ current_state: 'safe' })
                  .eq('id', currentState.id);
                
                // Pre-set both distance states to 'alerted' to suppress spurious alerts
                const altddPutDistKey = `altdd_put_dist_${strategy.strategy_key}`;
                await supabase.from('alert_states').upsert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  position_key: altddPutDistKey,
                  alert_type: ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_PUT,
                  current_state: 'alerted',
                  last_alerted_at: new Date().toISOString(),
                }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
                
                const altddCallDistKey = `altdd_call_dist_${strategy.strategy_key}`;
                await supabase.from('alert_states').upsert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  position_key: altddCallDistKey,
                  alert_type: ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_CALL,
                  current_state: 'alerted',
                  last_alerted_at: new Date().toISOString(),
                }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
              }
            }
            
            // Distance alerts for Alt DD PUT - SUPPRESSED if already OOR on PUT side
            const putDistConfig = getEffectiveConfig(configs || [], ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_PUT, ticker);
            if (putDistConfig.enabled && soldPutStrike > 0 && !isOOR_Put) {
              const distancePct = calcPutDistance(underlyingPrice, soldPutStrike);
              const isInDanger = distancePct < putDistConfig.threshold_pct;
              const positionKey = `altdd_put_dist_${strategy.strategy_key}`;
              const stateKey = `${positionKey}:${ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_PUT}`;
              const currentState = statesMap.get(stateKey);
              
              if (isInDanger && (!currentState || currentState.current_state === 'safe')) {
                if (cooldownPassed(currentState?.last_alerted_at || null, putDistConfig.cooldown_minutes)) {
                  const message = `${ticker} si avvicina allo strike della put venduta`;
                  
                  await supabase.from('alerts').insert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    alert_type: ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_PUT,
                    ticker,
                    strategy_type: 'Alternative Double Diagonal',
                    direction: 'down',
                    current_value: distancePct,
                    threshold_value: putDistConfig.threshold_pct,
                    strike_price: soldPutStrike,
                    underlying_price: underlyingPrice,
                    message,
                    severity: 'warning',
                    option_type: 'put',
                    option_expiry: strategy.sold_put_expiry,
                  });
                  totalAlertsCreated++;
                  
                  await supabase.from('alert_states').upsert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    position_key: positionKey,
                    alert_type: ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_PUT,
                    current_state: 'alerted',
                    last_alerted_at: new Date().toISOString(),
                  }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
                }
              } else if (!isInDanger && currentState?.current_state === 'alerted') {
                await supabase.from('alert_states')
                  .update({ current_state: 'safe' })
                  .eq('id', currentState.id);
              }
            }
            
            // Distance alerts for Alt DD CALL - SUPPRESSED if already OOR on CALL side
            const callDistConfig = getEffectiveConfig(configs || [], ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_CALL, ticker);
            if (callDistConfig.enabled && soldCallStrike > 0 && !isOOR_Call) {
              const distancePct = calcCallDistance(underlyingPrice, soldCallStrike);
              const isInDanger = distancePct < callDistConfig.threshold_pct;
              const positionKey = `altdd_call_dist_${strategy.strategy_key}`;
              const stateKey = `${positionKey}:${ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_CALL}`;
              const currentState = statesMap.get(stateKey);
              
              if (isInDanger && (!currentState || currentState.current_state === 'safe')) {
                if (cooldownPassed(currentState?.last_alerted_at || null, callDistConfig.cooldown_minutes)) {
                  const message = `${ticker} si avvicina allo strike della call venduta`;
                  
                  await supabase.from('alerts').insert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    alert_type: ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_CALL,
                    ticker,
                    strategy_type: 'Alternative Double Diagonal',
                    direction: 'up',
                    current_value: distancePct,
                    threshold_value: callDistConfig.threshold_pct,
                    strike_price: soldCallStrike,
                    underlying_price: underlyingPrice,
                    message,
                    severity: 'warning',
                    option_type: 'call',
                    option_expiry: strategy.sold_call_expiry,
                  });
                  totalAlertsCreated++;
                  
                  await supabase.from('alert_states').upsert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    position_key: positionKey,
                    alert_type: ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_CALL,
                    current_state: 'alerted',
                    last_alerted_at: new Date().toISOString(),
                  }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
                }
              } else if (!isInDanger && currentState?.current_state === 'alerted') {
                await supabase.from('alert_states')
                  .update({ current_state: 'safe' })
                  .eq('id', currentState.id);
              }
            }
          }
          
          // ============ LEAP CALL ============
          if (strategyType === 'LEAP Call') {
            // Get the actual position for gain calculation
            const positionId = strategy.position_ids[0];
            const position = (positions || []).find(p => p.id === positionId);
            if (!position) continue;
            
            const currentPrice = position.current_price || 0;
            const avgCost = position.avg_cost || 0;
            if (avgCost <= 0 || currentPrice <= 0) continue;
            
            // Check expiry (at least 6 months out)
            if (position.expiry_date) {
              const expiry = new Date(position.expiry_date);
              const now = new Date();
              const daysDiff = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
              if (daysDiff <= 180) continue;
            }
            
            const leapGainConfigs = [
              { type: ALERT_TYPES.ACTION_LEAP_GAIN_20, threshold: 1.20, label: '+20%' },
              { type: ALERT_TYPES.ACTION_LEAP_GAIN_30, threshold: 1.30, label: '+30%' },
              { type: ALERT_TYPES.ACTION_LEAP_GAIN_40, threshold: 1.40, label: '+40%' },
              { type: ALERT_TYPES.ACTION_LEAP_GAIN_50, threshold: 1.50, label: '+50%' },
            ];
            
            for (const leapConfig of leapGainConfigs) {
              const config = getEffectiveConfig(configs || [], leapConfig.type, ticker);
              if (!config.enabled) continue;
              
              const gainPct = ((currentPrice - avgCost) / avgCost) * 100;
              const isAboveThreshold = currentPrice >= avgCost * leapConfig.threshold;
              const positionKey = `leap_${leapConfig.type}_${strategy.strategy_key}`;
              const stateKey = `${positionKey}:${leapConfig.type}`;
              const currentState = statesMap.get(stateKey);
              
              if (isAboveThreshold && (!currentState || currentState.current_state === 'safe')) {
                if (cooldownPassed(currentState?.last_alerted_at || null, config.cooldown_minutes)) {
                  const message = `La LEAP sta guadagnando il ${leapConfig.label} (attuale: ${gainPct.toFixed(1)}%)`;
                  
                  await supabase.from('alerts').insert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    alert_type: leapConfig.type,
                    ticker,
                    strategy_type: 'LEAP Call',
                    direction: null,
                    current_value: gainPct,
                    threshold_value: (leapConfig.threshold - 1) * 100,
                    strike_price: position.strike_price,
                    underlying_price: underlyingPrice,
                    message,
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
          
          // ============ OTHER STRATEGIES (OOB) ============
          if (!strategy.is_range_strategy && 
              !['Covered Call', 'Naked Put', 'Iron Condor', 'Double Diagonal', 'LEAP Call', 'Alternative Double Diagonal'].includes(strategyType)) {
            // Get positions for breakeven calculation
            const strategyPositions = (positions || []).filter(p => strategy.position_ids.includes(p.id));
            if (strategyPositions.length === 0) continue;
            
            const oobConfig = getEffectiveConfig(configs || [], ALERT_TYPES.ACTION_STRATEGY_OOB, ticker);
            if (oobConfig.enabled) {
              const breakevens = calculateBreakevens(strategyPositions);
              const isOOB = isOutOfBreakeven(underlyingPrice, breakevens);
              const positionKey = `strategy_oob_${strategy.strategy_key}`;
              const stateKey = `${positionKey}:${ALERT_TYPES.ACTION_STRATEGY_OOB}`;
              const currentState = statesMap.get(stateKey);
              
              if (isOOB && (!currentState || currentState.current_state === 'safe')) {
                if (cooldownPassed(currentState?.last_alerted_at || null, oobConfig.cooldown_minutes)) {
                  const message = `La strategia è OOB (fuori dai breakeven)`;
                  
                  await supabase.from('alerts').insert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    alert_type: ALERT_TYPES.ACTION_STRATEGY_OOB,
                    ticker,
                    strategy_type: strategyType,
                    direction: null,
                    current_value: underlyingPrice,
                    threshold_value: breakevens.length > 0 ? breakevens[0] : null,
                    strike_price: null,
                    underlying_price: underlyingPrice,
                    message,
                    severity: 'critical',
                  });
                  totalAlertsCreated++;
                  
                  await supabase.from('alert_states').upsert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    position_key: positionKey,
                    alert_type: ALERT_TYPES.ACTION_STRATEGY_OOB,
                    current_state: 'alerted',
                    last_alerted_at: new Date().toISOString(),
                  }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
                }
              } else if (!isOOB && currentState?.current_state === 'alerted') {
                await supabase.from('alert_states')
                  .update({ current_state: 'safe' })
                  .eq('id', currentState.id);
              }
            }
          }
        }
      }
      
      // === PRICE ALERTS ===
      const { data: priceAlertsData, error: priceAlertsError } = await supabase
        .from('price_alerts')
        .select('*')
        .eq('user_id', userId)
        .eq('enabled', true);
      
      if (priceAlertsError) {
        console.error(`Error fetching price alerts for user ${userId}:`, priceAlertsError);
      } else if (priceAlertsData && priceAlertsData.length > 0) {
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
            
            const positionKey = `price_alert_${priceAlert.id}`;
            
            const { data: stateData } = await supabase
              .from('alert_states')
              .select('*')
              .eq('user_id', userId)
              .eq('position_key', positionKey)
              .eq('alert_type', alertType)
              .maybeSingle();
            
            const currentState = stateData as AlertState | null;
            
            if (isTriggered && (!currentState || currentState.current_state === 'safe')) {
              if (cooldownPassed(currentState?.last_alerted_at || priceAlert.last_triggered_at, priceAlert.cooldown_minutes)) {
                const direction = priceAlert.direction === 'above' ? 'sopra' : 'sotto';
                const message = `${priceAlert.ticker} ha raggiunto il prezzo target (${direction} $${priceAlert.target_price.toFixed(2)})`;
                
                await supabase.from('alerts').insert({
                  user_id: userId,
                  portfolio_id: null,
                  alert_type: alertType,
                  ticker: priceAlert.ticker,
                  strategy_type: 'Avviso Prezzo',
                  direction: priceAlert.direction === 'above' ? 'up' : 'down',
                  current_value: currentPrice,
                  threshold_value: priceAlert.target_price,
                  strike_price: null,
                  underlying_price: currentPrice,
                  message,
                  severity: 'info',
                });
                totalAlertsCreated++;
                
                // Check if this is a one-time alert
                if (priceAlert.delete_after_trigger) {
                  // Delete the alert rule
                  await supabase
                    .from('price_alerts')
                    .delete()
                    .eq('id', priceAlert.id);
                  
                  // Delete associated alert state
                  await supabase
                    .from('alert_states')
                    .delete()
                    .eq('user_id', userId)
                    .eq('position_key', positionKey);
                    
                  console.log(`Price alert ${priceAlert.id} deleted after trigger (one-time)`);
                } else {
                  // Standard behavior: update state and last_triggered_at
                  await supabase.from('alert_states').upsert({
                    user_id: userId,
                    portfolio_id: null,
                    position_key: positionKey,
                    alert_type: alertType,
                    current_state: 'alerted',
                    last_alerted_at: new Date().toISOString(),
                  }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
                  
                  await supabase
                    .from('price_alerts')
                    .update({ last_triggered_at: new Date().toISOString() })
                    .eq('id', priceAlert.id);
                }
              }
            } else if (!isTriggered && currentState?.current_state === 'alerted') {
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
