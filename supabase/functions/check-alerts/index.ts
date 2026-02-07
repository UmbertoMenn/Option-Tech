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
  market_value: number | null;
}

// ============ STRATEGY DETECTION INTERFACES ============

interface IronCondor {
  underlying: string;
  soldPut: Position;
  boughtPut: Position;
  soldCall: Position;
  boughtCall: Position;
  contracts: number;
}

interface DoubleDiagonal {
  underlying: string;
  soldPut: Position;
  boughtPut: Position;
  soldCall: Position;
  boughtCall: Position;
  contracts: number;
}

interface GroupedStrategy {
  underlying: string;
  options: Position[];
  strategyName: string | null;
  isRangeStrategy: boolean; // true = OOR logic, false = OOB logic
  soldPutStrike: number | null;
  soldCallStrike: number | null;
}

// ============ SPECIAL ALIASES ============

const SPECIAL_ALIASES: Record<string, string[]> = {
  ALPHABET: ['GOOGL', 'GOOG', 'GOOGLE', 'ALPHABET', 'ALPHABET INC', 'ALPHABET CLASS'],
  PDD: ['PDD', 'PINDUODUO', 'PDD HOLDINGS', 'PINDUODUO INC', 'PDD HOLDINGS INC'],
  NETEASE: ['NETEASE', 'NTES', 'NETEASE INC', 'NETEASE INC ADR'],
  ENI: ['ENI', 'ENI SPA', 'ENI STOCK', 'ENI - STOCK'],
  APPLE: ['APPLE', 'AAPL', 'APPLE INC', 'APPLE COMPUTER', 'APPLE COMPUTER INC'],
};

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

function getCanonicalKey(text: string): string | null {
  const normalized = normalizeForMatching(text);
  
  for (const [canonical, aliases] of Object.entries(SPECIAL_ALIASES)) {
    for (const alias of aliases) {
      const normalizedAlias = normalizeForMatching(alias);
      if (normalized === normalizedAlias || 
          normalized.includes(normalizedAlias) || 
          normalizedAlias.includes(normalized)) {
        return canonical;
      }
    }
  }
  
  return null;
}

function getTicker(position: Position): string {
  return position.ticker || position.description?.split(' ')[0] || 'N/A';
}

function getUnderlyingKey(position: Position): string {
  const text = `${position.underlying || ''} ${position.description || ''} ${position.ticker || ''}`;
  const canonical = getCanonicalKey(text);
  if (canonical) return canonical;
  return normalizeForMatching(position.underlying || position.description);
}

// ============ STRATEGY DETECTION FUNCTIONS ============

function groupOptionsByUnderlying(options: Position[]): Map<string, Position[]> {
  const groups = new Map<string, Position[]>();
  
  for (const option of options) {
    const key = getUnderlyingKey(option);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(option);
  }
  
  return groups;
}

function findMatchingStock(option: Position, stocks: Position[]): Position | undefined {
  const optionText = `${option.underlying || ''} ${option.description || ''} ${option.ticker || ''}`;
  const optionNormalized = normalizeForMatching(optionText);
  const optionCanonical = getCanonicalKey(optionText);
  
  // Check special aliases first
  if (optionCanonical) {
    const match = stocks.find(stock => {
      const stockCanonical = getCanonicalKey(stock.description) || getCanonicalKey(stock.ticker || '');
      return stockCanonical === optionCanonical;
    });
    if (match) return match;
  }
  
  // Check ticker containment
  const optionTokens = optionNormalized.split(' ').filter(w => w.length > 2);
  
  for (const stock of stocks) {
    const stockName = normalizeForMatching(stock.description);
    const stockTokens = stockName.split(' ').filter(w => w.length > 2);
    
    if (stock.ticker) {
      const t = normalizeForMatching(stock.ticker);
      if (t && optionNormalized.includes(t)) return stock;
    }
    
    if (stockName && optionNormalized.includes(stockName)) return stock;
    
    if (stockTokens.length > 0) {
      const shared = stockTokens.filter(t => optionTokens.includes(t)).length;
      const required = stockTokens.length === 1 ? 1 : Math.min(2, stockTokens.length);
      if (shared >= required) return stock;
    }
  }
  
  return undefined;
}

function tryMatchIronCondor(
  soldCalls: Position[],
  boughtCalls: Position[],
  soldPuts: Position[],
  boughtPuts: Position[]
): IronCondor | null {
  for (const soldCall of soldCalls) {
    const expiry = soldCall.expiry_date;
    const contracts = Math.abs(soldCall.quantity);
    
    const matchingBoughtCall = boughtCalls.find(bc =>
      bc.expiry_date === expiry && bc.quantity === contracts
    );
    if (!matchingBoughtCall) continue;
    
    const matchingSoldPut = soldPuts.find(sp =>
      sp.expiry_date === expiry && Math.abs(sp.quantity) === contracts
    );
    if (!matchingSoldPut) continue;
    
    const matchingBoughtPut = boughtPuts.find(bp =>
      bp.expiry_date === expiry && bp.quantity === contracts
    );
    if (!matchingBoughtPut) continue;
    
    return {
      underlying: soldCall.underlying || soldCall.description,
      soldPut: matchingSoldPut,
      boughtPut: matchingBoughtPut,
      soldCall,
      boughtCall: matchingBoughtCall,
      contracts
    };
  }
  
  return null;
}

function tryMatchDoubleDiagonal(
  soldCalls: Position[],
  boughtCalls: Position[],
  soldPuts: Position[],
  boughtPuts: Position[]
): DoubleDiagonal | null {
  for (const soldCall of soldCalls) {
    const soldExpiry = soldCall.expiry_date;
    const soldExpiryTime = soldExpiry ? new Date(soldExpiry).getTime() : 0;
    const contracts = Math.abs(soldCall.quantity);
    
    const matchingSoldPut = soldPuts.find(sp =>
      sp.expiry_date === soldExpiry && Math.abs(sp.quantity) === contracts
    );
    if (!matchingSoldPut) continue;
    
    const matchingBoughtCall = boughtCalls.find(bc =>
      bc.expiry_date && new Date(bc.expiry_date).getTime() > soldExpiryTime &&
      bc.quantity === contracts
    );
    if (!matchingBoughtCall) continue;
    
    const boughtExpiry = matchingBoughtCall.expiry_date;
    
    const matchingBoughtPut = boughtPuts.find(bp =>
      bp.expiry_date === boughtExpiry && bp.quantity === contracts
    );
    if (!matchingBoughtPut) continue;
    
    return {
      underlying: soldCall.underlying || soldCall.description,
      soldPut: matchingSoldPut,
      boughtPut: matchingBoughtPut,
      soldCall,
      boughtCall: matchingBoughtCall,
      contracts
    };
  }
  
  return null;
}

function normalizeRatios(quantities: number[]): number[] {
  const absQtys = quantities.map(q => Math.abs(q));
  let gcd = absQtys[0] || 1;
  for (let i = 1; i < absQtys.length; i++) {
    let a = gcd, b = absQtys[i];
    while (b) { const t = b; b = a % b; a = t; }
    gcd = a;
  }
  return quantities.map(q => q / gcd);
}

function detectStrategyName(options: Position[]): string | null {
  if (options.length < 2) return null;
  
  // Aggregate options with same strike, type, and expiry
  const aggregatedMap = new Map<string, { type: 'call' | 'put', strike: number, expiry: string, qty: number }>();
  
  for (const o of options) {
    const key = `${o.option_type}-${o.strike_price}-${o.expiry_date}`;
    if (aggregatedMap.has(key)) {
      aggregatedMap.get(key)!.qty += o.quantity;
    } else {
      aggregatedMap.set(key, {
        type: o.option_type as 'call' | 'put',
        strike: o.strike_price || 0,
        expiry: o.expiry_date || '',
        qty: o.quantity
      });
    }
  }
  
  const legs = Array.from(aggregatedMap.values()).sort((a, b) => a.strike - b.strike);
  
  const calls = legs.filter(l => l.type === 'call');
  const puts = legs.filter(l => l.type === 'put');
  const expiries = [...new Set(legs.map(l => l.expiry))];
  const sameExpiry = expiries.length === 1;
  const diffExpiry = expiries.length > 1;
  
  const normalized = normalizeRatios(legs.map(l => l.qty));
  
  // 2-LEG STRATEGIES
  if (legs.length === 2) {
    const [l1, l2] = legs;
    const [n1, n2] = normalized;
    const sameType = l1.type === l2.type;
    const sameStrike = l1.strike === l2.strike;
    
    // SHORT STRANGLE: 1 PUT venduta + 1 CALL venduta
    if (!sameType && sameExpiry && !sameStrike && n1 === -1 && n2 === -1) {
      const putLeg = legs.find(l => l.type === 'put');
      const callLeg = legs.find(l => l.type === 'call');
      if (putLeg && callLeg && putLeg.qty < 0 && callLeg.qty < 0) {
        return 'Short Strangle';
      }
    }
    
    // VERTICAL SPREAD (PUT)
    if (sameType && l1.type === 'put' && sameExpiry && !sameStrike) {
      const hasSold = legs.some(l => l.qty < 0);
      const hasBought = legs.some(l => l.qty > 0);
      if (hasSold && hasBought) {
        const boughtLeg = legs.find(l => l.qty > 0)!;
        const soldLeg = legs.find(l => l.qty < 0)!;
        if (boughtLeg.strike > soldLeg.strike) return 'Bear Put Spread';
        return 'Bull Put Spread';
      }
    }
    
    // VERTICAL SPREAD (CALL)
    if (sameType && l1.type === 'call' && sameExpiry && !sameStrike) {
      const hasSold = legs.some(l => l.qty < 0);
      const hasBought = legs.some(l => l.qty > 0);
      if (hasSold && hasBought) {
        const boughtLeg = legs.find(l => l.qty > 0)!;
        const soldLeg = legs.find(l => l.qty < 0)!;
        if (boughtLeg.strike < soldLeg.strike) return 'Bull Call Spread';
        return 'Bear Call Spread';
      }
    }
    
    // DIAGONAL SPREADS
    if (sameType && diffExpiry) {
      const hasSold = legs.some(l => l.qty < 0);
      const hasBought = legs.some(l => l.qty > 0);
      if (hasSold && hasBought) {
        return l1.type === 'call' ? 'Diagonal Call Spread' : 'Diagonal Put Spread';
      }
    }
  }
  
  // 3-LEG STRATEGIES
  if (legs.length === 3) {
    const strikes = legs.map(l => l.strike);
    const types = new Set(legs.map(l => l.type));
    
    // Only PUT strategies (Butterfly)
    if (types.size === 1 && legs[0].type === 'put') {
      const sortedByStrike = [...legs].sort((a, b) => a.strike - b.strike);
      const normSorted = normalizeRatios(sortedByStrike.map(l => l.qty));
      const isEquidistant = (strikes[2] - strikes[1]) === (strikes[1] - strikes[0]);
      
      if (normSorted[0] === 1 && normSorted[1] === -2 && normSorted[2] === 1) {
        if (!isEquidistant) return 'Put Broken Wing Butterfly';
        return 'Long Put Butterfly';
      }
    }
    
    // Only CALL strategies (Butterfly)
    if (types.size === 1 && legs[0].type === 'call') {
      const sortedByStrike = [...legs].sort((a, b) => a.strike - b.strike);
      const normSorted = normalizeRatios(sortedByStrike.map(l => l.qty));
      const isEquidistant = (strikes[2] - strikes[1]) === (strikes[1] - strikes[0]);
      
      if (normSorted[0] === 1 && normSorted[1] === -2 && normSorted[2] === 1) {
        if (!isEquidistant) return 'Call Broken Wing Butterfly';
        return 'Long Call Butterfly';
      }
    }
  }
  
  // 4-LEG STRATEGIES
  if (legs.length === 4 && puts.length === 2 && calls.length === 2 && diffExpiry) {
    const hasSoldPut = puts.some(l => l.qty < 0);
    const hasBoughtPut = puts.some(l => l.qty > 0);
    const hasSoldCall = calls.some(l => l.qty < 0);
    const hasBoughtCall = calls.some(l => l.qty > 0);
    
    if (hasSoldPut && hasBoughtPut && hasSoldCall && hasBoughtCall) {
      return 'Alternative Double Diagonal';
    }
  }
  
  // N-LEG SHORT STRANGLE
  if (puts.length > 0 && calls.length > 0 && 
      puts.every(p => p.qty < 0) && calls.every(c => c.qty < 0) && sameExpiry) {
    const putTotal = puts.reduce((s, p) => s + Math.abs(p.qty), 0);
    const callTotal = calls.reduce((s, c) => s + Math.abs(c.qty), 0);
    if (putTotal === callTotal) {
      return 'Short Strangle';
    }
  }
  
  return null;
}

// Check if strategy uses OOR logic (range-based) or OOB logic (breakeven-based)
function isRangeStrategy(strategyName: string | null): boolean {
  const rangeStrategies = [
    'Short Strangle',
    'Alternative Double Diagonal',
    'Bull Put Spread',
    'Bear Put Spread',
    'Bull Call Spread',
    'Bear Call Spread',
    'Diagonal Call Spread',
    'Diagonal Put Spread'
  ];
  return rangeStrategies.includes(strategyName || '');
}

// Get sold strikes from options group
function getSoldStrikes(options: Position[]): { soldPutStrike: number | null, soldCallStrike: number | null } {
  let soldPutStrike: number | null = null;
  let soldCallStrike: number | null = null;
  
  for (const o of options) {
    if (o.quantity < 0) { // Sold
      if (o.option_type === 'put' && o.strike_price) {
        if (!soldPutStrike || o.strike_price > soldPutStrike) {
          soldPutStrike = o.strike_price; // Highest sold put
        }
      }
      if (o.option_type === 'call' && o.strike_price) {
        if (!soldCallStrike || o.strike_price < soldCallStrike) {
          soldCallStrike = o.strike_price; // Lowest sold call
        }
      }
    }
  }
  
  return { soldPutStrike, soldCallStrike };
}

// Calculate breakeven points for a strategy
function calculateBreakevens(options: Position[]): number[] {
  if (options.length === 0) return [];
  
  const strikes = options.map(o => o.strike_price || 0).filter(s => s > 0);
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
    
    for (const o of options) {
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
  if (breakevens.length === 1) {
    // For single breakeven, check if we're on the losing side
    // This is simplistic - may need refinement for specific strategies
    return false;
  }
  
  const minBE = Math.min(...breakevens);
  const maxBE = Math.max(...breakevens);
  
  return underlyingPrice < minBE || underlyingPrice > maxBE;
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
        
        // Separate stock and option positions
        const stockPositions = (positions || []).filter(p => p.asset_type === 'stock');
        const optionPositions = (positions || []).filter(p => p.asset_type === 'derivative');
        
        // Filter out EUROFOREX
        const filteredOptions = optionPositions.filter(o => {
          const name = (o.underlying || o.description || '').toUpperCase();
          return !name.includes('EUROFOREX');
        });
        
        // Build underlying price map from stock positions AND underlying_prices table
        const underlyingPrices: Record<string, number> = {};
        
        // First from stock positions
        for (const stock of stockPositions) {
          const key = getUnderlyingKey(stock);
          if (stock.current_price && stock.current_price > 0) {
            underlyingPrices[key] = stock.current_price;
          }
        }
        
        // Then try to get from underlying_prices table for options without stock
        const optionTickers = [...new Set(filteredOptions.map(o => getTicker(o)).filter(t => t !== 'N/A'))];
        if (optionTickers.length > 0) {
          const { data: pricesData } = await supabase
            .from('underlying_prices')
            .select('ticker, price')
            .in('ticker', optionTickers);
          
          if (pricesData) {
            for (const p of pricesData) {
              const key = normalizeForMatching(p.ticker);
              if (p.price > 0 && !underlyingPrices[key]) {
                underlyingPrices[key] = p.price;
              }
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
        
        // ============ CATEGORIZE STRATEGIES ============
        const usedPositionIds = new Set<string>();
        const ironCondors: IronCondor[] = [];
        const doubleDiagonals: DoubleDiagonal[] = [];
        const groupedStrategies: GroupedStrategy[] = [];
        const coveredCallIds = new Set<string>();
        
        // STEP 1: Find Covered Calls
        const soldCalls = filteredOptions.filter(d => d.option_type === 'call' && d.quantity < 0);
        for (const call of soldCalls) {
          const underlyingStock = findMatchingStock(call, stockPositions);
          if (underlyingStock && underlyingStock.quantity > 0) {
            const contractsSold = Math.abs(call.quantity);
            const sharesOwned = underlyingStock.quantity;
            const contractsCoverable = Math.floor(sharesOwned / 100);
            
            if (contractsSold <= contractsCoverable) {
              usedPositionIds.add(call.id);
              coveredCallIds.add(call.id);
            }
          }
        }
        
        // STEP 2: Skip Protections (they don't need alerts)
        // Protections are Long PUT with underlying stock - no alert needed
        
        // STEP 3-4: Find Iron Condor and Double Diagonal
        const optionsByUnderlying = groupOptionsByUnderlying(
          filteredOptions.filter(o => !usedPositionIds.has(o.id))
        );
        
        for (const [underlying, group] of optionsByUnderlying.entries()) {
          const groupSoldCalls = group.filter(p => p.option_type === 'call' && p.quantity < 0 && !usedPositionIds.has(p.id));
          const groupBoughtCalls = group.filter(p => p.option_type === 'call' && p.quantity > 0 && !usedPositionIds.has(p.id));
          const groupSoldPuts = group.filter(p => p.option_type === 'put' && p.quantity < 0 && !usedPositionIds.has(p.id));
          const groupBoughtPuts = group.filter(p => p.option_type === 'put' && p.quantity > 0 && !usedPositionIds.has(p.id));
          
          // Try Iron Condor
          while (groupSoldCalls.length > 0 && groupBoughtCalls.length > 0 && 
                 groupSoldPuts.length > 0 && groupBoughtPuts.length > 0) {
            const ic = tryMatchIronCondor(groupSoldCalls, groupBoughtCalls, groupSoldPuts, groupBoughtPuts);
            
            if (ic) {
              ironCondors.push(ic);
              usedPositionIds.add(ic.soldPut.id);
              usedPositionIds.add(ic.boughtPut.id);
              usedPositionIds.add(ic.soldCall.id);
              usedPositionIds.add(ic.boughtCall.id);
              
              // Remove from arrays
              const idx1 = groupSoldCalls.findIndex(p => p.id === ic.soldCall.id);
              if (idx1 >= 0) groupSoldCalls.splice(idx1, 1);
              const idx2 = groupBoughtCalls.findIndex(p => p.id === ic.boughtCall.id);
              if (idx2 >= 0) groupBoughtCalls.splice(idx2, 1);
              const idx3 = groupSoldPuts.findIndex(p => p.id === ic.soldPut.id);
              if (idx3 >= 0) groupSoldPuts.splice(idx3, 1);
              const idx4 = groupBoughtPuts.findIndex(p => p.id === ic.boughtPut.id);
              if (idx4 >= 0) groupBoughtPuts.splice(idx4, 1);
              continue;
            }
            
            // Try Double Diagonal
            const dd = tryMatchDoubleDiagonal(groupSoldCalls, groupBoughtCalls, groupSoldPuts, groupBoughtPuts);
            
            if (dd) {
              doubleDiagonals.push(dd);
              usedPositionIds.add(dd.soldPut.id);
              usedPositionIds.add(dd.boughtPut.id);
              usedPositionIds.add(dd.soldCall.id);
              usedPositionIds.add(dd.boughtCall.id);
              
              const idx1 = groupSoldCalls.findIndex(p => p.id === dd.soldCall.id);
              if (idx1 >= 0) groupSoldCalls.splice(idx1, 1);
              const idx2 = groupBoughtCalls.findIndex(p => p.id === dd.boughtCall.id);
              if (idx2 >= 0) groupBoughtCalls.splice(idx2, 1);
              const idx3 = groupSoldPuts.findIndex(p => p.id === dd.soldPut.id);
              if (idx3 >= 0) groupSoldPuts.splice(idx3, 1);
              const idx4 = groupBoughtPuts.findIndex(p => p.id === dd.boughtPut.id);
              if (idx4 >= 0) groupBoughtPuts.splice(idx4, 1);
              continue;
            }
            
            break;
          }
        }
        
        // STEP 5: Find Other Strategies (2+ legs)
        const afterFourLeg = filteredOptions.filter(o => !usedPositionIds.has(o.id));
        const regrouped = groupOptionsByUnderlying(afterFourLeg);
        
        for (const [underlying, group] of regrouped.entries()) {
          if (group.length >= 2) {
            // Check if it's just LEAPs and Naked PUTs (not a real strategy)
            const onlyLeapsAndNakeds = group.every(option => 
              (option.option_type === 'call' && option.quantity > 0) || 
              (option.option_type === 'put' && option.quantity < 0)
            );
            
            if (!onlyLeapsAndNakeds) {
              const strategyName = detectStrategyName(group);
              const { soldPutStrike, soldCallStrike } = getSoldStrikes(group);
              
              groupedStrategies.push({
                underlying: group[0].underlying || group[0].description,
                options: group,
                strategyName,
                isRangeStrategy: isRangeStrategy(strategyName),
                soldPutStrike,
                soldCallStrike
              });
              
              // Mark all options as used
              for (const o of group) {
                usedPositionIds.add(o.id);
              }
            }
          }
        }
        
        console.log(`[Strategy Detection] IC: ${ironCondors.length}, DD: ${doubleDiagonals.length}, Other: ${groupedStrategies.length}, Used IDs: ${usedPositionIds.size}`);
        
        // ============ GENERATE ALERTS FOR IRON CONDORS ============
        for (const ic of ironCondors) {
          const ticker = getTicker(ic.soldCall);
          const underlyingKey = getUnderlyingKey(ic.soldCall);
          const underlyingPrice = underlyingPrices[underlyingKey] || 0;
          
          if (underlyingPrice <= 0) continue;
          
          const soldPutStrike = ic.soldPut.strike_price || 0;
          const soldCallStrike = ic.soldCall.strike_price || 0;
          
          // OOR Alert
          const oorConfig = getEffectiveConfig(configs || [], ALERT_TYPES.ACTION_DD_IC_OOR, ticker);
          if (oorConfig.enabled) {
            const isOOR = underlyingPrice < soldPutStrike || underlyingPrice > soldCallStrike;
            const positionKey = `ic_oor_${ic.soldCall.id}_${ic.soldPut.id}`;
            const stateKey = `${positionKey}:${ALERT_TYPES.ACTION_DD_IC_OOR}`;
            const currentState = statesMap.get(stateKey);
            
            if (isOOR && (!currentState || currentState.current_state === 'safe')) {
              if (cooldownPassed(currentState?.last_alerted_at || null, oorConfig.cooldown_minutes)) {
                const side = underlyingPrice < soldPutStrike ? 'PUT' : 'CALL';
                const message = `Iron Condor ${ticker} è OOR lato ${side} (sottostante $${underlyingPrice.toFixed(2)})`;
                
                await supabase.from('alerts').insert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  alert_type: ALERT_TYPES.ACTION_DD_IC_OOR,
                  ticker,
                  strategy_type: 'IC',
                  direction: side === 'PUT' ? 'down' : 'up',
                  current_value: underlyingPrice,
                  threshold_value: side === 'PUT' ? soldPutStrike : soldCallStrike,
                  strike_price: side === 'PUT' ? soldPutStrike : soldCallStrike,
                  underlying_price: underlyingPrice,
                  message,
                  severity: 'critical',
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
            }
          }
          
          // Distance alerts for IC
          // PUT side
          const putDistConfig = getEffectiveConfig(configs || [], ALERT_TYPES.DISTANCE_IRON_CONDOR_PUT, ticker);
          if (putDistConfig.enabled && soldPutStrike > 0) {
            const distancePct = calcPutDistance(underlyingPrice, soldPutStrike);
            const isInDanger = distancePct < putDistConfig.threshold_pct;
            const positionKey = `ic_put_dist_${ic.soldPut.id}`;
            const stateKey = `${positionKey}:${ALERT_TYPES.DISTANCE_IRON_CONDOR_PUT}`;
            const currentState = statesMap.get(stateKey);
            
            if (isInDanger && (!currentState || currentState.current_state === 'safe')) {
              if (cooldownPassed(currentState?.last_alerted_at || null, putDistConfig.cooldown_minutes)) {
                const message = `IC ${ticker} PUT $${soldPutStrike} vicino (distanza ${distancePct.toFixed(1)}%)`;
                
                await supabase.from('alerts').insert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  alert_type: ALERT_TYPES.DISTANCE_IRON_CONDOR_PUT,
                  ticker,
                  strategy_type: 'IC',
                  direction: 'down',
                  current_value: distancePct,
                  threshold_value: putDistConfig.threshold_pct,
                  strike_price: soldPutStrike,
                  underlying_price: underlyingPrice,
                  message,
                  severity: distancePct < putDistConfig.threshold_pct / 2 ? 'critical' : 'warning',
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
          
          // CALL side
          const callDistConfig = getEffectiveConfig(configs || [], ALERT_TYPES.DISTANCE_IRON_CONDOR_CALL, ticker);
          if (callDistConfig.enabled && soldCallStrike > 0) {
            const distancePct = calcCallDistance(underlyingPrice, soldCallStrike);
            const isInDanger = distancePct < callDistConfig.threshold_pct;
            const positionKey = `ic_call_dist_${ic.soldCall.id}`;
            const stateKey = `${positionKey}:${ALERT_TYPES.DISTANCE_IRON_CONDOR_CALL}`;
            const currentState = statesMap.get(stateKey);
            
            if (isInDanger && (!currentState || currentState.current_state === 'safe')) {
              if (cooldownPassed(currentState?.last_alerted_at || null, callDistConfig.cooldown_minutes)) {
                const message = `IC ${ticker} CALL $${soldCallStrike} vicino (distanza ${distancePct.toFixed(1)}%)`;
                
                await supabase.from('alerts').insert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  alert_type: ALERT_TYPES.DISTANCE_IRON_CONDOR_CALL,
                  ticker,
                  strategy_type: 'IC',
                  direction: 'up',
                  current_value: distancePct,
                  threshold_value: callDistConfig.threshold_pct,
                  strike_price: soldCallStrike,
                  underlying_price: underlyingPrice,
                  message,
                  severity: distancePct < callDistConfig.threshold_pct / 2 ? 'critical' : 'warning',
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
        
        // ============ GENERATE ALERTS FOR DOUBLE DIAGONALS ============
        for (const dd of doubleDiagonals) {
          const ticker = getTicker(dd.soldCall);
          const underlyingKey = getUnderlyingKey(dd.soldCall);
          const underlyingPrice = underlyingPrices[underlyingKey] || 0;
          
          if (underlyingPrice <= 0) continue;
          
          const soldPutStrike = dd.soldPut.strike_price || 0;
          const soldCallStrike = dd.soldCall.strike_price || 0;
          
          // OOR Alert
          const oorConfig = getEffectiveConfig(configs || [], ALERT_TYPES.ACTION_DD_IC_OOR, ticker);
          if (oorConfig.enabled) {
            const isOOR = underlyingPrice < soldPutStrike || underlyingPrice > soldCallStrike;
            const positionKey = `dd_oor_${dd.soldCall.id}_${dd.soldPut.id}`;
            const stateKey = `${positionKey}:${ALERT_TYPES.ACTION_DD_IC_OOR}`;
            const currentState = statesMap.get(stateKey);
            
            if (isOOR && (!currentState || currentState.current_state === 'safe')) {
              if (cooldownPassed(currentState?.last_alerted_at || null, oorConfig.cooldown_minutes)) {
                const side = underlyingPrice < soldPutStrike ? 'PUT' : 'CALL';
                const message = `Double Diagonal ${ticker} è OOR lato ${side} (sottostante $${underlyingPrice.toFixed(2)})`;
                
                await supabase.from('alerts').insert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  alert_type: ALERT_TYPES.ACTION_DD_IC_OOR,
                  ticker,
                  strategy_type: 'DD',
                  direction: side === 'PUT' ? 'down' : 'up',
                  current_value: underlyingPrice,
                  threshold_value: side === 'PUT' ? soldPutStrike : soldCallStrike,
                  strike_price: side === 'PUT' ? soldPutStrike : soldCallStrike,
                  underlying_price: underlyingPrice,
                  message,
                  severity: 'critical',
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
            }
          }
          
          // Distance alerts for DD
          const putDistConfig = getEffectiveConfig(configs || [], ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_PUT, ticker);
          if (putDistConfig.enabled && soldPutStrike > 0) {
            const distancePct = calcPutDistance(underlyingPrice, soldPutStrike);
            const isInDanger = distancePct < putDistConfig.threshold_pct;
            const positionKey = `dd_put_dist_${dd.soldPut.id}`;
            const stateKey = `${positionKey}:${ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_PUT}`;
            const currentState = statesMap.get(stateKey);
            
            if (isInDanger && (!currentState || currentState.current_state === 'safe')) {
              if (cooldownPassed(currentState?.last_alerted_at || null, putDistConfig.cooldown_minutes)) {
                const message = `DD ${ticker} PUT $${soldPutStrike} vicino (distanza ${distancePct.toFixed(1)}%)`;
                
                await supabase.from('alerts').insert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  alert_type: ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_PUT,
                  ticker,
                  strategy_type: 'DD',
                  direction: 'down',
                  current_value: distancePct,
                  threshold_value: putDistConfig.threshold_pct,
                  strike_price: soldPutStrike,
                  underlying_price: underlyingPrice,
                  message,
                  severity: distancePct < putDistConfig.threshold_pct / 2 ? 'critical' : 'warning',
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
          
          const callDistConfig = getEffectiveConfig(configs || [], ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_CALL, ticker);
          if (callDistConfig.enabled && soldCallStrike > 0) {
            const distancePct = calcCallDistance(underlyingPrice, soldCallStrike);
            const isInDanger = distancePct < callDistConfig.threshold_pct;
            const positionKey = `dd_call_dist_${dd.soldCall.id}`;
            const stateKey = `${positionKey}:${ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_CALL}`;
            const currentState = statesMap.get(stateKey);
            
            if (isInDanger && (!currentState || currentState.current_state === 'safe')) {
              if (cooldownPassed(currentState?.last_alerted_at || null, callDistConfig.cooldown_minutes)) {
                const message = `DD ${ticker} CALL $${soldCallStrike} vicino (distanza ${distancePct.toFixed(1)}%)`;
                
                await supabase.from('alerts').insert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  alert_type: ALERT_TYPES.DISTANCE_DOUBLE_DIAGONAL_CALL,
                  ticker,
                  strategy_type: 'DD',
                  direction: 'up',
                  current_value: distancePct,
                  threshold_value: callDistConfig.threshold_pct,
                  strike_price: soldCallStrike,
                  underlying_price: underlyingPrice,
                  message,
                  severity: distancePct < callDistConfig.threshold_pct / 2 ? 'critical' : 'warning',
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
        
        // ============ GENERATE ALERTS FOR OTHER STRATEGIES ============
        for (const gs of groupedStrategies) {
          const ticker = getTicker(gs.options[0]);
          const underlyingKey = getUnderlyingKey(gs.options[0]);
          const underlyingPrice = underlyingPrices[underlyingKey] || 0;
          
          if (underlyingPrice <= 0) continue;
          
          const positionIds = gs.options.map(o => o.id).sort().join('_');
          
          if (gs.isRangeStrategy) {
            // OOR logic for range strategies (Strangle, Spread, Alternative DD)
            const oorConfig = getEffectiveConfig(configs || [], ALERT_TYPES.ACTION_DD_IC_OOR, ticker);
            if (oorConfig.enabled && gs.soldPutStrike && gs.soldCallStrike) {
              const isOOR = underlyingPrice < gs.soldPutStrike || underlyingPrice > gs.soldCallStrike;
              const positionKey = `strategy_oor_${positionIds}`;
              const stateKey = `${positionKey}:${ALERT_TYPES.ACTION_DD_IC_OOR}`;
              const currentState = statesMap.get(stateKey);
              
              if (isOOR && (!currentState || currentState.current_state === 'safe')) {
                if (cooldownPassed(currentState?.last_alerted_at || null, oorConfig.cooldown_minutes)) {
                  const side = underlyingPrice < gs.soldPutStrike ? 'PUT' : 'CALL';
                  const strategyLabel = gs.strategyName || 'Strategia';
                  const message = `${strategyLabel} ${ticker} è OOR lato ${side} (sottostante $${underlyingPrice.toFixed(2)})`;
                  
                  await supabase.from('alerts').insert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    alert_type: ALERT_TYPES.ACTION_DD_IC_OOR,
                    ticker,
                    strategy_type: gs.strategyName || 'STRATEGY',
                    direction: side === 'PUT' ? 'down' : 'up',
                    current_value: underlyingPrice,
                    threshold_value: side === 'PUT' ? gs.soldPutStrike : gs.soldCallStrike,
                    strike_price: side === 'PUT' ? gs.soldPutStrike : gs.soldCallStrike,
                    underlying_price: underlyingPrice,
                    message,
                    severity: 'critical',
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
              }
            }
            
            // Distance alerts for sold strikes (for range strategies)
            if (gs.soldPutStrike) {
              const putDistConfig = getEffectiveConfig(configs || [], ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_PUT, ticker);
              if (putDistConfig.enabled) {
                const distancePct = calcPutDistance(underlyingPrice, gs.soldPutStrike);
                const isInDanger = distancePct < putDistConfig.threshold_pct;
                const positionKey = `strategy_put_dist_${positionIds}`;
                const stateKey = `${positionKey}:${ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_PUT}`;
                const currentState = statesMap.get(stateKey);
                
                if (isInDanger && (!currentState || currentState.current_state === 'safe')) {
                  if (cooldownPassed(currentState?.last_alerted_at || null, putDistConfig.cooldown_minutes)) {
                    const strategyLabel = gs.strategyName || 'Strategia';
                    const message = `${strategyLabel} ${ticker} PUT $${gs.soldPutStrike} vicino (distanza ${distancePct.toFixed(1)}%)`;
                    
                    await supabase.from('alerts').insert({
                      user_id: userId,
                      portfolio_id: portfolioId,
                      alert_type: ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_PUT,
                      ticker,
                      strategy_type: gs.strategyName || 'STRATEGY',
                      direction: 'down',
                      current_value: distancePct,
                      threshold_value: putDistConfig.threshold_pct,
                      strike_price: gs.soldPutStrike,
                      underlying_price: underlyingPrice,
                      message,
                      severity: distancePct < putDistConfig.threshold_pct / 2 ? 'critical' : 'warning',
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
            }
            
            if (gs.soldCallStrike) {
              const callDistConfig = getEffectiveConfig(configs || [], ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_CALL, ticker);
              if (callDistConfig.enabled) {
                const distancePct = calcCallDistance(underlyingPrice, gs.soldCallStrike);
                const isInDanger = distancePct < callDistConfig.threshold_pct;
                const positionKey = `strategy_call_dist_${positionIds}`;
                const stateKey = `${positionKey}:${ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_CALL}`;
                const currentState = statesMap.get(stateKey);
                
                if (isInDanger && (!currentState || currentState.current_state === 'safe')) {
                  if (cooldownPassed(currentState?.last_alerted_at || null, callDistConfig.cooldown_minutes)) {
                    const strategyLabel = gs.strategyName || 'Strategia';
                    const message = `${strategyLabel} ${ticker} CALL $${gs.soldCallStrike} vicino (distanza ${distancePct.toFixed(1)}%)`;
                    
                    await supabase.from('alerts').insert({
                      user_id: userId,
                      portfolio_id: portfolioId,
                      alert_type: ALERT_TYPES.DISTANCE_ALTERNATIVE_DD_CALL,
                      ticker,
                      strategy_type: gs.strategyName || 'STRATEGY',
                      direction: 'up',
                      current_value: distancePct,
                      threshold_value: callDistConfig.threshold_pct,
                      strike_price: gs.soldCallStrike,
                      underlying_price: underlyingPrice,
                      message,
                      severity: distancePct < callDistConfig.threshold_pct / 2 ? 'critical' : 'warning',
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
          } else {
            // OOB logic for breakeven strategies (Butterfly, etc.)
            const oobConfig = getEffectiveConfig(configs || [], ALERT_TYPES.ACTION_STRATEGY_OOB, ticker);
            if (oobConfig.enabled) {
              const breakevens = calculateBreakevens(gs.options);
              const isOOB = isOutOfBreakeven(underlyingPrice, breakevens);
              const positionKey = `strategy_oob_${positionIds}`;
              const stateKey = `${positionKey}:${ALERT_TYPES.ACTION_STRATEGY_OOB}`;
              const currentState = statesMap.get(stateKey);
              
              if (isOOB && (!currentState || currentState.current_state === 'safe')) {
                if (cooldownPassed(currentState?.last_alerted_at || null, oobConfig.cooldown_minutes)) {
                  const strategyLabel = gs.strategyName || 'Strategia';
                  const message = `${strategyLabel} ${ticker} è OOB (sottostante $${underlyingPrice.toFixed(2)})`;
                  
                  await supabase.from('alerts').insert({
                    user_id: userId,
                    portfolio_id: portfolioId,
                    alert_type: ALERT_TYPES.ACTION_STRATEGY_OOB,
                    ticker,
                    strategy_type: gs.strategyName || 'STRATEGY',
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
        
        // ============ PROCESS SINGLE POSITIONS (ONLY UNUSED) ============
        
        // Covered Call distance alerts (only for positions marked as CC)
        for (const option of filteredOptions) {
          if (!coveredCallIds.has(option.id)) continue;
          
          const ticker = getTicker(option);
          const strikePrice = option.strike_price || 0;
          const underlyingKey = getUnderlyingKey(option);
          const underlyingPrice = underlyingPrices[underlyingKey] || 0;
          
          if (underlyingPrice <= 0 || strikePrice <= 0) continue;
          
          // Distance alert
          const config = getEffectiveConfig(configs || [], ALERT_TYPES.DISTANCE_COVERED_CALL, ticker);
          if (config.enabled) {
            const distancePct = calcCallDistance(underlyingPrice, strikePrice);
            const isInDanger = distancePct < config.threshold_pct;
            const positionKey = `cc_dist_${option.id}`;
            const stateKey = `${positionKey}:${ALERT_TYPES.DISTANCE_COVERED_CALL}`;
            const currentState = statesMap.get(stateKey);
            
            if (isInDanger && (!currentState || currentState.current_state === 'safe')) {
              if (cooldownPassed(currentState?.last_alerted_at || null, config.cooldown_minutes)) {
                const message = `CC ${ticker} $${strikePrice} si avvicina (distanza ${distancePct.toFixed(1)}%)`;
                
                await supabase.from('alerts').insert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  alert_type: ALERT_TYPES.DISTANCE_COVERED_CALL,
                  ticker,
                  strategy_type: 'CC',
                  direction: 'up',
                  current_value: distancePct,
                  threshold_value: config.threshold_pct,
                  strike_price: strikePrice,
                  underlying_price: underlyingPrice,
                  message,
                  severity: distancePct < config.threshold_pct / 2 ? 'critical' : 'warning',
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
          
          // ITM alert
          const itmConfig = getEffectiveConfig(configs || [], ALERT_TYPES.ACTION_COVERED_CALL_ITM, ticker);
          if (itmConfig.enabled) {
            const isITM = underlyingPrice > strikePrice;
            const positionKey = `cc_itm_${option.id}`;
            const stateKey = `${positionKey}:${ALERT_TYPES.ACTION_COVERED_CALL_ITM}`;
            const currentState = statesMap.get(stateKey);
            
            if (isITM && (!currentState || currentState.current_state === 'safe')) {
              if (cooldownPassed(currentState?.last_alerted_at || null, itmConfig.cooldown_minutes)) {
                const message = `CC ${ticker} $${strikePrice} è ITM (sottostante $${underlyingPrice.toFixed(2)})`;
                
                await supabase.from('alerts').insert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  alert_type: ALERT_TYPES.ACTION_COVERED_CALL_ITM,
                  ticker,
                  strategy_type: 'CC',
                  direction: 'up',
                  current_value: underlyingPrice,
                  threshold_value: strikePrice,
                  strike_price: strikePrice,
                  underlying_price: underlyingPrice,
                  message,
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
        
        // Naked Put alerts (ONLY for unused positions)
        const npItmConfig = getEffectiveConfig(configs || [], ALERT_TYPES.ACTION_NAKED_PUT_ITM);
        if (npItmConfig.enabled) {
          for (const option of filteredOptions) {
            // SKIP if part of a strategy
            if (usedPositionIds.has(option.id)) continue;
            if (option.option_type !== 'put' || option.quantity >= 0) continue;
            
            const ticker = getTicker(option);
            const strikePrice = option.strike_price || 0;
            const underlyingKey = getUnderlyingKey(option);
            const underlyingPrice = underlyingPrices[underlyingKey] || 0;
            
            if (underlyingPrice <= 0 || strikePrice <= 0) continue;
            
            const isITM = strikePrice > underlyingPrice;
            const positionKey = `np_itm_${option.id}`;
            const stateKey = `${positionKey}:${ALERT_TYPES.ACTION_NAKED_PUT_ITM}`;
            const currentState = statesMap.get(stateKey);
            
            if (isITM && (!currentState || currentState.current_state === 'safe')) {
              if (cooldownPassed(currentState?.last_alerted_at || null, npItmConfig.cooldown_minutes)) {
                const message = `Naked Put ${ticker} $${strikePrice} è ITM (sottostante $${underlyingPrice.toFixed(2)})`;
                
                await supabase.from('alerts').insert({
                  user_id: userId,
                  portfolio_id: portfolioId,
                  alert_type: ALERT_TYPES.ACTION_NAKED_PUT_ITM,
                  ticker,
                  strategy_type: 'NP',
                  direction: 'down',
                  current_value: underlyingPrice,
                  threshold_value: strikePrice,
                  strike_price: strikePrice,
                  underlying_price: underlyingPrice,
                  message,
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
        
        // Naked Put distance alerts (ONLY for unused positions)
        for (const option of filteredOptions) {
          // SKIP if part of a strategy
          if (usedPositionIds.has(option.id)) continue;
          if (option.option_type !== 'put' || option.quantity >= 0) continue;
          
          const ticker = getTicker(option);
          const strikePrice = option.strike_price || 0;
          const underlyingKey = getUnderlyingKey(option);
          const underlyingPrice = underlyingPrices[underlyingKey] || 0;
          
          if (underlyingPrice <= 0 || strikePrice <= 0) continue;
          
          const config = getEffectiveConfig(configs || [], ALERT_TYPES.DISTANCE_NAKED_PUT, ticker);
          if (!config.enabled) continue;
          
          const distancePct = calcPutDistance(underlyingPrice, strikePrice);
          const isInDanger = distancePct < config.threshold_pct;
          const positionKey = `np_dist_${option.id}`;
          const stateKey = `${positionKey}:${ALERT_TYPES.DISTANCE_NAKED_PUT}`;
          const currentState = statesMap.get(stateKey);
          
          if (isInDanger && (!currentState || currentState.current_state === 'safe')) {
            if (cooldownPassed(currentState?.last_alerted_at || null, config.cooldown_minutes)) {
              const message = `NP ${ticker} $${strikePrice} si avvicina (distanza ${distancePct.toFixed(1)}%)`;
              
              await supabase.from('alerts').insert({
                user_id: userId,
                portfolio_id: portfolioId,
                alert_type: ALERT_TYPES.DISTANCE_NAKED_PUT,
                ticker,
                strategy_type: 'NP',
                direction: 'down',
                current_value: distancePct,
                threshold_value: config.threshold_pct,
                strike_price: strikePrice,
                underlying_price: underlyingPrice,
                message,
                severity: distancePct < config.threshold_pct / 2 ? 'critical' : 'warning',
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
        
        // LEAP gains (ONLY for unused positions)
        const leapGainConfigs = [
          { type: ALERT_TYPES.ACTION_LEAP_GAIN_20, threshold: 1.20 },
          { type: ALERT_TYPES.ACTION_LEAP_GAIN_30, threshold: 1.30 },
          { type: ALERT_TYPES.ACTION_LEAP_GAIN_40, threshold: 1.40 },
          { type: ALERT_TYPES.ACTION_LEAP_GAIN_50, threshold: 1.50 },
        ];
        
        for (const leapConfig of leapGainConfigs) {
          const config = getEffectiveConfig(configs || [], leapConfig.type);
          if (!config.enabled) continue;
          
          for (const option of filteredOptions) {
            // SKIP if part of a strategy
            if (usedPositionIds.has(option.id)) continue;
            if (option.option_type !== 'call' || option.quantity <= 0) continue;
            if (!option.expiry_date) continue;
            
            const expiry = new Date(option.expiry_date);
            const now = new Date();
            const daysDiff = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
            if (daysDiff <= 180) continue; // At least 6 months out
            
            const ticker = getTicker(option);
            const currentPrice = option.current_price || 0;
            const avgCost = option.avg_cost || 0;
            
            if (avgCost <= 0) continue;
            
            const gainPct = ((currentPrice - avgCost) / avgCost) * 100;
            const isAboveThreshold = currentPrice >= avgCost * leapConfig.threshold;
            const positionKey = `leap_${leapConfig.type}_${option.id}`;
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
                  ticker,
                  strategy_type: 'LEAP',
                  direction: null,
                  current_value: gainPct,
                  threshold_value: (leapConfig.threshold - 1) * 100,
                  strike_price: option.strike_price,
                  underlying_price: null,
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
            const stateKey = `${positionKey}:${alertType}`;
            
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
                const direction = priceAlert.direction === 'above' ? 'salito sopra' : 'sceso sotto';
                const message = `${priceAlert.ticker} è ${direction} $${priceAlert.target_price.toFixed(2)} (prezzo attuale: $${currentPrice.toFixed(2)})`;
                
                const { error: alertError } = await supabase
                  .from('alerts')
                  .insert({
                    user_id: userId,
                    portfolio_id: null,
                    alert_type: alertType,
                    ticker: priceAlert.ticker,
                    strategy_type: 'PRICE',
                    direction: priceAlert.direction === 'above' ? 'up' : 'down',
                    current_value: currentPrice,
                    threshold_value: priceAlert.target_price,
                    strike_price: null,
                    underlying_price: currentPrice,
                    message,
                    severity: 'info',
                  });
                
                if (alertError) {
                  console.error('Error creating price alert:', alertError);
                } else {
                  totalAlertsCreated++;
                  console.log(`Created price alert: ${message}`);
                }
                
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
