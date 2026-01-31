import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Position {
  id: string;
  asset_type: string;
  ticker: string | null;
  isin: string | null;
  underlying: string | null;
  expiry_date: string | null;
  option_type: string | null;
  strike_price: number | null;
  quantity: number;
  avg_cost: number | null;
  exchange_rate: number | null;
  current_price: number | null;
}

interface PriceData {
  symbol: string;
  price: number | null;
  source: string;
}

interface FetchResult {
  stocks: Record<string, PriceData>;
  options: Record<string, PriceData>;
  isinMappings: Record<string, string>;
}

/**
 * Calculate market value for a position
 */
function calculateMarketValue(position: Position, newPrice: number): number {
  const multiplier = position.asset_type === 'derivative' ? 100 : 1;
  const exchangeRate = position.exchange_rate ?? 1;
  return (newPrice * position.quantity * multiplier) / exchangeRate;
}

/**
 * Calculate profit/loss for a position
 */
function calculateProfitLoss(position: Position, newPrice: number): number {
  const marketValue = calculateMarketValue(position, newPrice);
  const avgCost = position.avg_cost ?? 0;
  const multiplier = position.asset_type === 'derivative' ? 100 : 1;
  const exchangeRate = position.exchange_rate ?? 1;
  const costBasis = (avgCost * Math.abs(position.quantity) * multiplier) / exchangeRate;
  
  // For short positions (negative quantity), profit is inverted
  return position.quantity < 0 ? -(marketValue + costBasis) : marketValue - costBasis;
}

/**
 * Calculate profit/loss percentage
 */
function calculateProfitLossPct(position: Position, profitLoss: number): number {
  const avgCost = position.avg_cost ?? 0;
  const multiplier = position.asset_type === 'derivative' ? 100 : 1;
  const exchangeRate = position.exchange_rate ?? 1;
  const costBasis = (avgCost * Math.abs(position.quantity) * multiplier) / exchangeRate;
  
  if (costBasis === 0) return 0;
  return (profitLoss / Math.abs(costBasis)) * 100;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  let logId: string | null = null;

  try {
    // Get request body (optional, for manual triggers)
    let source = 'cron';
    try {
      const body = await req.json();
      source = body?.source || 'cron';
    } catch {
      // No body is fine
    }

    console.log(`[update-prices-cron] Starting price update (source: ${source})`);

    // Create Supabase client with service role to bypass RLS
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Create log entry
    const { data: logEntry } = await supabase
      .from('price_update_logs')
      .insert({ source, started_at: new Date().toISOString() })
      .select('id')
      .single();
    
    logId = logEntry?.id;

    // Step 1: Fetch all positions (stocks, ETFs, derivatives)
    const { data: positions, error: positionsError } = await supabase
      .from('positions')
      .select('id, asset_type, ticker, isin, underlying, expiry_date, option_type, strike_price, quantity, avg_cost, exchange_rate, current_price')
      .in('asset_type', ['stock', 'etf', 'derivative']);

    if (positionsError) {
      throw new Error(`Failed to fetch positions: ${positionsError.message}`);
    }

    if (!positions || positions.length === 0) {
      console.log('[update-prices-cron] No positions to update');
      
      if (logId) {
        await supabase.from('price_update_logs').update({
          completed_at: new Date().toISOString(),
          positions_updated: 0,
          positions_failed: 0,
        }).eq('id', logId);
      }
      
      return new Response(JSON.stringify({
        success: true,
        updated: 0,
        failed: 0,
        duration: Date.now() - startTime,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[update-prices-cron] Found ${positions.length} positions to update`);

    // Step 2: Separate stocks/ETFs from derivatives
    const stockPositions = positions.filter(
      (p: Position) => p.asset_type === 'stock' || p.asset_type === 'etf'
    );
    const derivativePositions = positions.filter(
      (p: Position) => p.asset_type === 'derivative' &&
        p.underlying &&
        p.expiry_date &&
        p.option_type &&
        p.strike_price
    );

    // Step 3: Extract unique tickers and ISINs
    const tickers = [...new Set(
      stockPositions
        .map((p: Position) => p.ticker)
        .filter((t: string | null): t is string => !!t && t.length > 0)
    )];

    const isins = [...new Set(
      stockPositions
        .filter((p: Position) => !p.ticker && p.isin)
        .map((p: Position) => p.isin)
        .filter((i: string | null): i is string => !!i && i.length > 0)
    )];

    // Step 4: Build option requests
    const optionRequests = derivativePositions.map((p: Position) => ({
      underlying: p.underlying!,
      expiry: p.expiry_date!,
      optionType: p.option_type as 'call' | 'put',
      strike: p.strike_price!,
      originalId: p.id,
    }));

    console.log(`[update-prices-cron] Fetching: ${tickers.length} tickers, ${isins.length} ISINs, ${optionRequests.length} options`);

    // Step 5: Call fetch-market-prices function internally
    const fetchResponse = await fetch(`${supabaseUrl}/functions/v1/fetch-market-prices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        tickers,
        isins,
        options: optionRequests,
      }),
    });

    if (!fetchResponse.ok) {
      const errorText = await fetchResponse.text();
      throw new Error(`fetch-market-prices failed: ${fetchResponse.status} - ${errorText}`);
    }

    const priceData: FetchResult = await fetchResponse.json();
    console.log(`[update-prices-cron] Received ${Object.keys(priceData.stocks).length} stock prices, ${Object.keys(priceData.options).length} option prices`);

    // Step 6: Build updates for each position
    const updates: {
      id: string;
      current_price: number;
      market_value: number;
      profit_loss: number;
      profit_loss_pct: number;
      updated_at: string;
    }[] = [];
    
    let failedCount = 0;

    for (const position of positions as Position[]) {
      let priceInfo: PriceData | null = null;

      if (position.asset_type === 'derivative') {
        // Options are keyed by originalId
        priceInfo = priceData.options[position.id] || null;
      } else {
        // Stocks/ETFs - try ticker first, then ISIN
        if (position.ticker && priceData.stocks[position.ticker]) {
          priceInfo = priceData.stocks[position.ticker];
        } else if (position.isin && priceData.stocks[position.isin]) {
          priceInfo = priceData.stocks[position.isin];
        }
      }

      if (priceInfo && priceInfo.price !== null && priceInfo.source !== 'error') {
        const newPrice = priceInfo.price;
        const marketValue = calculateMarketValue(position, newPrice);
        const profitLoss = calculateProfitLoss(position, newPrice);
        const profitLossPct = calculateProfitLossPct(position, profitLoss);

        updates.push({
          id: position.id,
          current_price: newPrice,
          market_value: marketValue,
          profit_loss: profitLoss,
          profit_loss_pct: profitLossPct,
          updated_at: new Date().toISOString(),
        });
      } else {
        failedCount++;
      }
    }

    console.log(`[update-prices-cron] Prepared ${updates.length} updates, ${failedCount} failed`);

    // Step 7: Batch update positions (in chunks of 50)
    const BATCH_SIZE = 50;
    let totalUpdated = 0;

    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      
      // Use individual updates since upsert requires all columns
      for (const update of batch) {
        const { error: updateError } = await supabase
          .from('positions')
          .update({
            current_price: update.current_price,
            market_value: update.market_value,
            profit_loss: update.profit_loss,
            profit_loss_pct: update.profit_loss_pct,
            updated_at: update.updated_at,
          })
          .eq('id', update.id);

        if (!updateError) {
          totalUpdated++;
        } else {
          console.error(`[update-prices-cron] Failed to update ${update.id}: ${updateError.message}`);
          failedCount++;
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[update-prices-cron] Completed: ${totalUpdated} updated, ${failedCount} failed, ${duration}ms`);

    // Update log entry
    if (logId) {
      await supabase.from('price_update_logs').update({
        completed_at: new Date().toISOString(),
        positions_updated: totalUpdated,
        positions_failed: failedCount,
      }).eq('id', logId);
    }

    return new Response(JSON.stringify({
      success: true,
      updated: totalUpdated,
      failed: failedCount,
      duration,
      timestamp: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[update-prices-cron] Error:', errorMessage);

    // Update log entry with error
    if (logId) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, serviceRoleKey);
      
      await supabase.from('price_update_logs').update({
        completed_at: new Date().toISOString(),
        error_message: errorMessage,
      }).eq('id', logId);
    }

    return new Response(JSON.stringify({
      success: false,
      error: errorMessage,
      duration: Date.now() - startTime,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
