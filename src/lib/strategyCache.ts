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
  // First check if the underlying itself looks like a ticker (1-5 uppercase letters)
  const tickerMatch = underlying.match(/^[A-Z]{1,5}$/);
  if (tickerMatch) return underlying;
  
  // Check direct match in prices map
  const priceData = underlyingPrices[underlying];
  if (priceData?.ticker) {
    return priceData.ticker;
  }
  
  // Try to find by searching keys
  const upperUnderlying = underlying.toUpperCase();
  for (const [key, value] of Object.entries(underlyingPrices)) {
    const upperKey = key.toUpperCase();
    if (upperKey === upperUnderlying || upperKey.includes(upperUnderlying) || upperUnderlying.includes(upperKey)) {
      if (value.ticker) return value.ticker;
    }
  }
  
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
      strategy_key: `cc_${cc.option.id}`,
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
  
  // 2. Naked Puts
  categories.nakedPuts.forEach((np: NakedPutPosition, idx: number) => {
    const underlying = np.option.underlying || np.option.description || '';
    const ticker = resolveTicker(underlying, underlyingPrices);
    
    records.push({
      portfolio_id: portfolioId,
      strategy_key: `np_${np.option.id}`,
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
      strategy_key: `ic_${ic.soldPut.id}_${ic.soldCall.id}`,
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
      strategy_key: `dd_${dd.soldPut.id}_${dd.soldCall.id}`,
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
      strategy_key: `leap_${lc.option.id}`,
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
      strategy_key: `other_${positionIds.sort().join('_')}`,
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
  
  // Delete existing cache and insert new
  const { error: deleteError } = await supabase
    .from('strategy_cache')
    .delete()
    .eq('portfolio_id', portfolioId);
  
  if (deleteError) {
    console.error('Error clearing strategy cache:', deleteError);
    return;
  }
  
  // Insert in batches
  const batchSize = 50;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error: insertError } = await supabase
      .from('strategy_cache')
      .insert(batch as any);
    
    if (insertError) {
      console.error('Error saving strategy cache batch:', insertError);
    }
  }
  
  // Cleanup orphaned covered call premiums
  // Extract active tickers from Covered Calls
  const activeCCTickers: string[] = [];
  categories.coveredCalls.forEach((cc: CoveredCallPosition) => {
    const underlying = cc.option.underlying || cc.option.description || '';
    const ticker = resolveTicker(underlying, underlyingPrices);
    if (ticker) {
      activeCCTickers.push(ticker.toUpperCase());
    }
  });
  
  // Delete premiums for tickers that are no longer in active covered calls
  if (activeCCTickers.length > 0) {
    // Get all premiums for this portfolio and delete those not in active list
    const { data: existingPremiums } = await supabase
      .from('covered_call_premiums')
      .select('ticker')
      .eq('portfolio_id', portfolioId);
    
    if (existingPremiums && existingPremiums.length > 0) {
      const tickersToDelete = existingPremiums
        .map(row => row.ticker)
        .filter(ticker => !activeCCTickers.includes(ticker.toUpperCase()));
      
      if (tickersToDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from('covered_call_premiums')
          .delete()
          .eq('portfolio_id', portfolioId)
          .in('ticker', tickersToDelete);
        
        if (!deleteError) {
          console.log(`[StrategyCache] Cleaned up ${tickersToDelete.length} orphaned premium records`);
        }
      }
    }
  } else {
    // No active covered calls - delete all premiums for this portfolio
    await supabase
      .from('covered_call_premiums')
      .delete()
      .eq('portfolio_id', portfolioId);
  }
  
  console.log(`[StrategyCache] Saved ${records.length} strategies for portfolio ${portfolioId}`);
}
