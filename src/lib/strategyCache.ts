import { supabase } from '@/integrations/supabase/client';
import { 
  DerivativeCategories, 
  CoveredCallPosition,
  NakedPutPosition,
  IronCondorPosition,
  DoubleDiagonalPosition,
  LeapCallPosition,
  GroupedOtherStrategy
} from './derivativeStrategies';
import { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';

function formatExpiryKey(expiry: string | null | undefined): string {
  if (!expiry) return 'noexp';
  const d = new Date(expiry);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface StrategyRecord {
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

/**
 * Resolve ticker from underlying name using the prices map
 * The prices map is keyed by underlying name with UnderlyingPrice as value
 */
function resolveTicker(underlying: string, underlyingPrices: Record<string, UnderlyingPrice>): string | null {
  // 1. Direct match (via underlying_mappings populated map)
  const priceData = underlyingPrices[underlying];
  if (priceData?.ticker) return priceData.ticker;
  
  // 2. Case-insensitive exact match only — NO fuzzy/includes
  const upperUnderlying = underlying.toUpperCase();
  for (const [key, value] of Object.entries(underlyingPrices)) {
    if (key.toUpperCase() === upperUnderlying && value.ticker) return value.ticker;
  }
  
  // 3. Fallback: underlying itself looks like a ticker (1-5 uppercase, optional .XX suffix)
  if (/^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(underlying)) return underlying;
  
  return null;
}

/**
 * Save all categorized strategies to the database cache
 * Called when Derivatives.tsx renders the strategies
 */
export async function saveStrategyCache(
  portfolioId: string,
  categories: DerivativeCategories,
  underlyingPrices: Record<string, UnderlyingPrice>
): Promise<void> {
  const records: StrategyRecord[] = [];
  
  // 1. Covered Calls
  categories.coveredCalls.forEach((cc: CoveredCallPosition, idx: number) => {
    const underlying = cc.option.underlying || cc.option.description || '';
    const ticker = resolveTicker(underlying, underlyingPrices);
    
    records.push({
      portfolio_id: portfolioId,
      strategy_key: `cc_${underlying}_${cc.option.strike_price || 0}_${formatExpiryKey(cc.option.expiry_date)}`,
      strategy_type: 'Covered Call',
      underlying,
      ticker,
      position_ids: [cc.option.id],
      sold_put_strike: null,
      sold_call_strike: cc.option.strike_price || null,
      bought_put_strike: null,
      bought_call_strike: null,
      is_range_strategy: false, // CC uses ITM logic, not OOR
      sold_call_expiry: cc.option.expiry_date || null,
      sold_put_expiry: null,
    });
  });
  
  // 1b. De-Risking Covered Calls
  (categories.deRiskingCoveredCalls || []).forEach((dcc) => {
    const underlying = dcc.coveredCall.option.underlying || dcc.coveredCall.option.description || '';
    const ticker = resolveTicker(underlying, underlyingPrices);
    const posIds = [dcc.coveredCall.option.id];
    if (dcc.protectionPut) posIds.push(dcc.protectionPut.id);
    if (dcc.syntheticPut) posIds.push(dcc.syntheticPut.id);
    if (dcc.syntheticCall) posIds.push(dcc.syntheticCall.id);
    
    records.push({
      portfolio_id: portfolioId,
      strategy_key: `dcc_${underlying}_${dcc.coveredCall.option.strike_price || 0}_${formatExpiryKey(dcc.coveredCall.option.expiry_date)}`,
      strategy_type: 'De-Risking Covered Call',
      underlying,
      ticker,
      position_ids: posIds,
      sold_put_strike: null,
      sold_call_strike: dcc.coveredCall.option.strike_price || null,
      bought_put_strike: null,
      bought_call_strike: null,
      is_range_strategy: false,
      sold_call_expiry: dcc.coveredCall.option.expiry_date || null,
      sold_put_expiry: null,
    });
  });
  
  // 2. Naked Puts
  categories.nakedPuts.forEach((np: NakedPutPosition, idx: number) => {
    const underlying = np.option.underlying || np.option.description || '';
    const ticker = resolveTicker(underlying, underlyingPrices);
    
    records.push({
      portfolio_id: portfolioId,
      strategy_key: `np_${underlying}_${np.option.strike_price || 0}_${formatExpiryKey(np.option.expiry_date)}`,
      strategy_type: 'Naked Put',
      underlying,
      ticker,
      position_ids: [np.option.id],
      sold_put_strike: np.option.strike_price || null,
      sold_call_strike: null,
      bought_put_strike: null,
      bought_call_strike: null,
      is_range_strategy: false, // NP uses ITM logic, not OOR
      sold_call_expiry: null,
      sold_put_expiry: np.option.expiry_date || null,
    });
  });
  
  // 3. Iron Condors
  categories.ironCondors.forEach((ic: IronCondorPosition, idx: number) => {
    const ticker = resolveTicker(ic.underlying, underlyingPrices);
    
    records.push({
      portfolio_id: portfolioId,
      strategy_key: `ic_${ic.underlying}_${ic.soldPut.strike_price || 0}_${ic.soldCall.strike_price || 0}_${formatExpiryKey(ic.soldCall.expiry_date)}`,
      strategy_type: 'Iron Condor',
      underlying: ic.underlying,
      ticker,
      position_ids: [ic.soldPut.id, ic.boughtPut.id, ic.soldCall.id, ic.boughtCall.id],
      sold_put_strike: ic.soldPut.strike_price || null,
      sold_call_strike: ic.soldCall.strike_price || null,
      bought_put_strike: ic.boughtPut.strike_price || null,
      bought_call_strike: ic.boughtCall.strike_price || null,
      is_range_strategy: true,
      sold_call_expiry: ic.soldCall.expiry_date || null,
      sold_put_expiry: ic.soldPut.expiry_date || null,
    });
  });
  
  // 4. Double Diagonals
  categories.doubleDiagonals.forEach((dd: DoubleDiagonalPosition, idx: number) => {
    const ticker = resolveTicker(dd.underlying, underlyingPrices);
    
    records.push({
      portfolio_id: portfolioId,
      strategy_key: `dd_${dd.underlying}_${dd.soldPut.strike_price || 0}_${dd.soldCall.strike_price || 0}_${formatExpiryKey(dd.soldCall.expiry_date)}`,
      strategy_type: 'Double Diagonal',
      underlying: dd.underlying,
      ticker,
      position_ids: [dd.soldPut.id, dd.boughtPut.id, dd.soldCall.id, dd.boughtCall.id],
      sold_put_strike: dd.soldPut.strike_price || null,
      sold_call_strike: dd.soldCall.strike_price || null,
      bought_put_strike: dd.boughtPut.strike_price || null,
      bought_call_strike: dd.boughtCall.strike_price || null,
      is_range_strategy: true,
      sold_call_expiry: dd.soldCall.expiry_date || null,
      sold_put_expiry: dd.soldPut.expiry_date || null,
    });
  });
  
  // 5. LEAP Calls
  categories.leapCalls.forEach((lc: LeapCallPosition, idx: number) => {
    const underlying = lc.option.underlying || lc.option.description || '';
    const ticker = resolveTicker(underlying, underlyingPrices);
    
    records.push({
      portfolio_id: portfolioId,
      strategy_key: `leap_${underlying}_${lc.option.strike_price || 0}_${formatExpiryKey(lc.option.expiry_date)}`,
      strategy_type: 'LEAP Call',
      underlying,
      ticker,
      position_ids: [lc.option.id],
      sold_put_strike: null,
      sold_call_strike: null,
      bought_put_strike: null,
      bought_call_strike: lc.option.strike_price || null,
      is_range_strategy: false,
      sold_call_expiry: null,
      sold_put_expiry: null,
    });
  });
  
  // 6. Grouped Other Strategies
  categories.groupedOtherStrategies.forEach((gs: GroupedOtherStrategy, idx: number) => {
    const ticker = resolveTicker(gs.underlying, underlyingPrices);
    const positionIds = gs.options.map(o => o.option.id);
    
    // Calculate sold strikes and expiry
    let soldPutStrike: number | null = null;
    let soldCallStrike: number | null = null;
    let boughtPutStrike: number | null = null;
    let boughtCallStrike: number | null = null;
    let soldPutExpiry: string | null = null;
    let soldCallExpiry: string | null = null;
    
    for (const opt of gs.options) {
      const o = opt.option;
      if (o.quantity < 0) {
        // Sold
        if (o.option_type === 'put' && o.strike_price) {
          if (!soldPutStrike || o.strike_price > soldPutStrike) {
            soldPutStrike = o.strike_price;
            soldPutExpiry = o.expiry_date || null;
          }
        }
        if (o.option_type === 'call' && o.strike_price) {
          if (!soldCallStrike || o.strike_price < soldCallStrike) {
            soldCallStrike = o.strike_price;
            soldCallExpiry = o.expiry_date || null;
          }
        }
      } else {
        // Bought
        if (o.option_type === 'put' && o.strike_price) {
          if (!boughtPutStrike || o.strike_price < boughtPutStrike) {
            boughtPutStrike = o.strike_price;
          }
        }
        if (o.option_type === 'call' && o.strike_price) {
          if (!boughtCallStrike || o.strike_price > boughtCallStrike) {
            boughtCallStrike = o.strike_price;
          }
        }
      }
    }
    
    // Determine if range strategy (OOR) or breakeven strategy (OOB)
    const rangeStrategies = [
      'Short Strangle', 'Alternative Double Diagonal',
      'Bull Put Spread', 'Bear Put Spread', 'Bull Call Spread', 'Bear Call Spread',
      'Diagonal Call Spread', 'Diagonal Put Spread'
    ];
    const isRangeStrategy = rangeStrategies.includes(gs.strategyName || '');
    
    records.push({
      portfolio_id: portfolioId,
      strategy_key: `other_${gs.underlying}_${[soldPutStrike, soldCallStrike].filter(Boolean).sort().join('_')}_${formatExpiryKey(soldCallExpiry || soldPutExpiry)}`,
      strategy_type: gs.strategyName || 'Altre Strategie',
      underlying: gs.underlying,
      ticker,
      position_ids: positionIds,
      sold_put_strike: soldPutStrike,
      sold_call_strike: soldCallStrike,
      bought_put_strike: boughtPutStrike,
      bought_call_strike: boughtCallStrike,
      is_range_strategy: isRangeStrategy,
      sold_call_expiry: soldCallExpiry,
      sold_put_expiry: soldPutExpiry,
    });
  });
  
  // Don't save protections (longPuts) - they don't need alerts
  
  if (records.length === 0) {
    // Delete any existing cache for this portfolio
    await supabase
      .from('strategy_cache')
      .delete()
      .eq('portfolio_id', portfolioId);
    return;
  }
  
  // Upsert in batches (robust against concurrent saves)
  const batchSize = 50;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error: upsertError } = await supabase
      .from('strategy_cache')
      .upsert(batch as any, { onConflict: 'portfolio_id,strategy_key' });
    
    if (upsertError) {
      console.error('Error upserting strategy cache batch:', upsertError);
    }
  }
  
  // Cleanup obsolete entries
  const activeKeys = new Set(records.map(r => r.strategy_key));
  const { data: existing } = await supabase
    .from('strategy_cache')
    .select('strategy_key')
    .eq('portfolio_id', portfolioId);
  
  const keysToDelete = (existing || [])
    .filter(e => !activeKeys.has(e.strategy_key))
    .map(e => e.strategy_key);
  
  if (keysToDelete.length > 0) {
    await supabase
      .from('strategy_cache')
      .delete()
      .eq('portfolio_id', portfolioId)
      .in('strategy_key', keysToDelete);
    console.log(`[StrategyCache] Cleaned up ${keysToDelete.length} obsolete entries`);
  }
  
  console.log(`[StrategyCache] Saved ${records.length} strategies for portfolio ${portfolioId}`);
}
