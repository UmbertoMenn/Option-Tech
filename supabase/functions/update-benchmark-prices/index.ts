import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Benchmark tickers to track
const BENCHMARK_TICKERS = [
  "SPY",     // S&P 500
  "QQQ",     // Nasdaq-100
  "AGG",     // iShares Core US Aggregate Bond
  "EURUSD=X", // EUR/USD exchange rate
];

// Backfill period in years
const BACKFILL_YEARS = 3;

interface YahooChartResult {
  chart: {
    result: Array<{
      timestamp: number[];
      indicators: {
        adjclose: Array<{
          adjclose: number[];
        }>;
      };
    }>;
    error?: {
      code: string;
      description: string;
    };
  };
}

async function fetchYahooFinanceHistory(
  ticker: string,
  fromDate: Date,
  toDate: Date
): Promise<Array<{ date: string; close: number }>> {
  const period1 = Math.floor(fromDate.getTime() / 1000);
  const period2 = Math.floor(toDate.getTime() / 1000);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker
  )}?period1=${period1}&period2=${period2}&interval=1d&events=history`;

  console.log(`Fetching ${ticker} from ${fromDate.toISOString()} to ${toDate.toISOString()}`);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance API error for ${ticker}: ${response.status}`);
  }

  const data: YahooChartResult = await response.json();

  if (data.chart.error) {
    throw new Error(`Yahoo Finance error for ${ticker}: ${data.chart.error.description}`);
  }

  const result = data.chart.result?.[0];
  if (!result || !result.timestamp || !result.indicators?.adjclose?.[0]?.adjclose) {
    console.warn(`No data returned for ${ticker}`);
    return [];
  }

  const timestamps = result.timestamp;
  const closes = result.indicators.adjclose[0].adjclose;

  const prices: Array<{ date: string; close: number }> = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] !== null && closes[i] !== undefined) {
      const date = new Date(timestamps[i] * 1000);
      const dateStr = date.toISOString().split("T")[0];
      prices.push({ date: dateStr, close: closes[i] });
    }
  }

  console.log(`Fetched ${prices.length} data points for ${ticker}`);
  return prices;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body for options
    let backfill = false;
    let tickersToUpdate = BENCHMARK_TICKERS;

    try {
      const body = await req.json();
      backfill = body.backfill === true;
      if (body.tickers && Array.isArray(body.tickers)) {
        tickersToUpdate = body.tickers;
      }
    } catch {
      // No body or invalid JSON, use defaults
    }

    const results: Record<string, { inserted: number; error?: string }> = {};
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    for (const ticker of tickersToUpdate) {
      try {
        // Determine the start date
        let fromDate: Date;

        if (backfill) {
          // Backfill: go back BACKFILL_YEARS
          fromDate = new Date();
          fromDate.setFullYear(fromDate.getFullYear() - BACKFILL_YEARS);
        } else {
          // Incremental: find the latest date we have for this ticker
          const { data: latestRecord } = await supabase
            .from("benchmark_prices")
            .select("price_date")
            .eq("ticker", ticker)
            .order("price_date", { ascending: false })
            .limit(1)
            .single();

          if (latestRecord) {
            // Start from the day after the latest record
            fromDate = new Date(latestRecord.price_date);
            fromDate.setDate(fromDate.getDate() + 1);
          } else {
            // No data yet, do a backfill
            fromDate = new Date();
            fromDate.setFullYear(fromDate.getFullYear() - BACKFILL_YEARS);
          }
        }

        // Skip if we're already up to date
        if (fromDate > today) {
          console.log(`${ticker} is already up to date`);
          results[ticker] = { inserted: 0 };
          continue;
        }

        // Fetch historical data
        const prices = await fetchYahooFinanceHistory(ticker, fromDate, today);

        if (prices.length === 0) {
          results[ticker] = { inserted: 0 };
          continue;
        }

        // Upsert into database
        const records = prices.map((p) => ({
          ticker,
          price_date: p.date,
          close_price: p.close,
        }));

        const { error } = await supabase
          .from("benchmark_prices")
          .upsert(records, { onConflict: "ticker,price_date" });

        if (error) {
          throw error;
        }

        results[ticker] = { inserted: prices.length };
        console.log(`Inserted ${prices.length} records for ${ticker}`);

        // Rate limiting: wait 500ms between tickers to avoid Yahoo rate limits
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Error processing ${ticker}:`, error);
        results[ticker] = {
          inserted: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        results,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in update-benchmark-prices:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
