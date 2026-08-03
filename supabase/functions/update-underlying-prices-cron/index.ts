import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  hasBudgetLeft,
  isEuropeanTicker,
  runWithConcurrency,
  selectStaleFirst,
  type LastUpdatedMap,
} from "./scheduler.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// --- Autenticazione cron -------------------------------------------------
// Il segreto condiviso vive nel Vault del database (vault.decrypted_secrets,
// name = 'cron_secret'): e' la stessa sorgente usata dai job pg_cron e dal
// trigger notify_on_new_alert. Validarlo tramite la RPC `verify_cron_secret`
// mantiene una singola fonte di verita'. Affidarsi alla sola env var
// CRON_SECRET faceva rispondere 401 a ogni chiamata cron quando la env var
// non era configurata (incidente del 2026-07-22: prezzi fermi).
async function isAuthorizedCronRequest(req: Request): Promise<boolean> {
  const provided = req.headers.get("x-cron-secret");
  if (!provided) return false;

  const envSecret = Deno.env.get("CRON_SECRET");
  if (envSecret && provided === envSecret) return true;

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const { data, error } = await admin.rpc("verify_cron_secret", { p_secret: provided });
    if (error) {
      console.error("verify_cron_secret RPC failed:", error.message);
      return false;
    }
    return data === true;
  } catch (e) {
    console.error("verify_cron_secret RPC threw:", e instanceof Error ? e.message : String(e));
    return false;
  }
}

function unauthorizedCronResponse(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// --- Budget di esecuzione e quote per run --------------------------------
// Incidente del 2026-07-31: la funzione processava tutti i ticker US in una
// sola invocazione con una pausa di 60 secondi tra un batch Finnhub e l'altro.
// Con ~90 ticker US il run sforava e il gateway rispondeva 504 (10 volte in 3
// ore) lasciando i prezzi fermi.
//
// Il job gira ogni 5 minuti: ogni invocazione consuma al massimo la quota di
// una finestra di rate limit Finnhub (60 chiamate/minuto) partendo dai ticker
// piu' stantii. Nessuna attesa artificiale, nessun run appeso; il ciclo
// completo si chiude in ceil(N / quota) run.
const RUN_BUDGET_MS = Number(Deno.env.get("UNDERLYING_CRON_BUDGET_MS") ?? 90_000);
const FINNHUB_MAX_CALLS_PER_RUN = Number(Deno.env.get("FINNHUB_MAX_CALLS_PER_RUN") ?? 60);
const YAHOO_MAX_CALLS_PER_RUN = Number(Deno.env.get("YAHOO_MAX_CALLS_PER_RUN") ?? 60);
const FINNHUB_CONCURRENCY = 6;
const YAHOO_CONCURRENCY = 4;
// Le scritture vengono svuotate a blocchi: se il run venisse comunque troncato,
// i prezzi gia' letti sarebbero gia' a database invece di andare persi.
const UPSERT_FLUSH_SIZE = 20;

interface PriceRow {
  ticker: string;
  price: number;
  currency: string;
  updated_at: string;
}

// Fetch price from Yahoo Finance (for EU tickers)
async function fetchYahooPrice(ticker: string): Promise<{ price: number; currency: string } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    if (!response.ok) {
      console.log(`Yahoo API returned ${response.status} for ${ticker}`);
      return null;
    }
    
    const data = await response.json();
    const result = data.chart?.result?.[0];
    
    if (!result) {
      console.log(`No result in Yahoo response for ${ticker}`);
      return null;
    }
    
    const meta = result.meta;
    const price = meta.regularMarketPrice || meta.previousClose;
    
    if (!price || price <= 0) {
      console.log(`Invalid price for ${ticker}: ${price}`);
      return null;
    }
    
    return {
      price,
      currency: meta.currency || 'USD',
    };
  } catch (error) {
    console.error(`Error fetching Yahoo price for ${ticker}:`, error);
    return null;
  }
}

// Fetch price from Finnhub (for US tickers)
async function fetchFinnhubPrice(ticker: string, apiKey: string): Promise<{ price: number; currency: string } | null> {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.log(`Finnhub API returned ${response.status} for ${ticker}`);
      return null;
    }
    
    const data = await response.json();
    // Finnhub response: { c: currentPrice, h: high, l: low, o: open, pc: previousClose, t: timestamp }
    const price = data.c; // Current price
    
    if (!price || price <= 0) {
      // Fallback to previous close if current price is 0 (market closed)
      if (data.pc && data.pc > 0) {
        console.log(`Using previous close for ${ticker}: ${data.pc}`);
        return { price: data.pc, currency: 'USD' };
      }
      console.log(`Invalid Finnhub price for ${ticker}: ${price}`);
      return null;
    }
    
    return { price, currency: 'USD' };
  } catch (error) {
    console.error(`Error fetching Finnhub price for ${ticker}:`, error);
    return null;
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!(await isAuthorizedCronRequest(req))) {
    return unauthorizedCronResponse();
  }

  const startTime = Date.now();
  console.log("=== Update Underlying Prices Cron Job Started ===");

  try {
    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const finnhubApiKey = Deno.env.get("FINNHUB_API_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase configuration");
    }
    
    if (!finnhubApiKey) {
      console.warn("FINNHUB_API_KEY not configured - will use Yahoo Finance for all tickers");
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Step 1: Get ISINs from active STOCK positions
    const { data: stockPositions, error: stockError } = await supabase
      .from('positions')
      .select('isin')
      .eq('asset_type', 'stock')
      .not('isin', 'is', null);
    
    if (stockError) {
      console.error("Error fetching stock positions:", stockError.message);
    }

    const stockIsins = [...new Set(stockPositions?.map(p => p.isin).filter(Boolean) || [])];
    console.log(`Found ${stockIsins.length} unique ISINs from stock positions`);

    // Resolve tickers from ISINs via isin_mappings
    let tickersFromStocks: string[] = [];
    if (stockIsins.length > 0) {
      const { data: isinMappings, error: isinError } = await supabase
        .from('isin_mappings')
        .select('ticker')
        .in('isin', stockIsins);
      
      if (isinError) {
        console.error("Error fetching isin_mappings:", isinError.message);
      }
      
      tickersFromStocks = isinMappings?.map(m => m.ticker).filter(Boolean) || [];
      console.log(`Resolved ${tickersFromStocks.length} tickers from stock ISINs`);
    }

    // Step 2: Get underlyings from active DERIVATIVE positions
    const { data: derivativePositions, error: derivError } = await supabase
      .from('positions')
      .select('underlying')
      .eq('asset_type', 'derivative')
      .not('underlying', 'is', null);
    
    if (derivError) {
      console.error("Error fetching derivative positions:", derivError.message);
    }

    const underlyings = [...new Set(derivativePositions?.map(p => p.underlying).filter(Boolean) || [])];
    console.log(`Found ${underlyings.length} unique underlyings from derivative positions`);

    // Resolve tickers from underlyings via underlying_mappings (with normalization fallback)
    let tickersFromDerivatives: string[] = [];
    if (underlyings.length > 0) {
      const normalizeUnderlying = (s: string): string => {
        return String(s || '')
          .toUpperCase()
          .replace(/[.,'"`]/g, '')
          .replace(/\s+/g, ' ')
          .replace(/\b(INC|CORP|CORPORATION|CO|COMPANY|LTD|LLC|PLC|SA|NV|AG|SE|HOLDINGS?|GROUP|GRP)\b/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      };

      const { data: allMappings, error: umError } = await supabase
        .from('underlying_mappings')
        .select('underlying, ticker');

      if (umError) {
        console.error("Error fetching underlying_mappings:", umError.message);
      }

      const exactMap: Record<string, string> = {};
      const normalizedMap: Record<string, string> = {};
      (allMappings || []).forEach((m: any) => {
        if (m.underlying && m.ticker) {
          exactMap[m.underlying] = m.ticker;
          normalizedMap[normalizeUnderlying(m.underlying)] = m.ticker;
        }
      });

      const resolved = new Set<string>();
      const unresolved: string[] = [];
      for (const u of underlyings) {
        const t = exactMap[u] || normalizedMap[normalizeUnderlying(u)];
        if (t) resolved.add(t);
        else unresolved.push(u);
      }
      tickersFromDerivatives = [...resolved];
      console.log(`Resolved ${tickersFromDerivatives.length} tickers from derivative underlyings`);
      if (unresolved.length > 0) {
        console.log(`Unresolved underlyings (no mapping): ${unresolved.join(', ')}`);
      }
    }


    // Step 3: Get tickers from price_alerts
    const { data: priceAlerts, error: priceAlertsError } = await supabase
      .from('price_alerts')
      .select('ticker')
      .eq('enabled', true);
    
    if (priceAlertsError) {
      console.error("Error fetching price_alerts:", priceAlertsError.message);
    }

    const tickersFromPriceAlerts = [...new Set(priceAlerts?.map(p => p.ticker).filter(Boolean) || [])];
    console.log(`Found ${tickersFromPriceAlerts.length} unique tickers from price_alerts`);

    // Step 4: Consolidate and deduplicate all tickers
    const uniqueTickers = [...new Set([...tickersFromStocks, ...tickersFromDerivatives, ...tickersFromPriceAlerts])];
    console.log(`Total unique tickers to update: ${uniqueTickers.length}`);

    if (uniqueTickers.length === 0) {
      console.log("No active positions found - nothing to update");
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "No active positions to update",
          stocks_found: stockIsins.length,
          derivatives_found: underlyings.length,
          updated: 0,
          failed: 0,
          duration_ms: Date.now() - startTime
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 5: Leggi l'ultimo aggiornamento noto per ordinare i ticker dal piu'
    // stantio al piu' fresco. Cosi' il lavoro si distribuisce sui run
    // successivi senza mai lasciare indietro sempre gli stessi ticker.
    const lastUpdated: LastUpdatedMap = {};
    const { data: existingPrices, error: existingError } = await supabase
      .from('underlying_prices')
      .select('ticker, updated_at');

    if (existingError) {
      console.error("Error fetching underlying_prices:", existingError.message);
    }
    (existingPrices || []).forEach((row: any) => {
      if (row?.ticker) lastUpdated[row.ticker] = row.updated_at;
    });

    // Step 6: Separa EU e US e applica le quote per singolo run
    const allEuTickers = uniqueTickers.filter(t => isEuropeanTicker(t));
    const allUsTickers = uniqueTickers.filter(t => !isEuropeanTicker(t));

    const useFinnhub = Boolean(finnhubApiKey);
    const euTickers = selectStaleFirst(allEuTickers, lastUpdated, YAHOO_MAX_CALLS_PER_RUN);
    const usTickers = selectStaleFirst(
      allUsTickers,
      lastUpdated,
      useFinnhub ? FINNHUB_MAX_CALLS_PER_RUN : YAHOO_MAX_CALLS_PER_RUN,
    );

    console.log(`EU tickers (Yahoo Finance): ${euTickers.length}/${allEuTickers.length}`);
    console.log(`US tickers (${useFinnhub ? 'Finnhub' : 'Yahoo fallback'}): ${usTickers.length}/${allUsTickers.length}`);

    let updated = 0;
    let failed = 0;
    let skipped = 0;
    const errors: string[] = [];
    let pending: PriceRow[] = [];

    const withinBudget = () => hasBudgetLeft(startTime, RUN_BUDGET_MS, Date.now());

    async function flushPending(force = false): Promise<void> {
      if (pending.length === 0) return;
      if (!force && pending.length < UPSERT_FLUSH_SIZE) return;

      const batch = pending;
      pending = [];

      const { error: upsertError } = await supabase
        .from('underlying_prices')
        .upsert(batch, { onConflict: 'ticker' });

      if (upsertError) {
        console.error(`Failed to upsert ${batch.length} prices:`, upsertError.message);
        failed += batch.length;
        errors.push(`upsert failed for ${batch.length} tickers: ${upsertError.message}`);
      } else {
        updated += batch.length;
      }
    }

    async function processTicker(
      ticker: string,
      fetcher: (t: string) => Promise<{ price: number; currency: string } | null>,
      label: string,
    ): Promise<void> {
      try {
        const priceResult = await fetcher(ticker);

        if (priceResult) {
          pending.push({
            ticker,
            price: priceResult.price,
            currency: priceResult.currency,
            updated_at: new Date().toISOString(),
          });
          console.log(`[${label}] Fetched ${ticker}: ${priceResult.price} ${priceResult.currency}`);
          await flushPending();
        } else {
          console.log(`[${label}] No price for ${ticker}`);
          failed++;
          errors.push(`${ticker}: no ${label} data`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Error processing ${ticker}:`, errorMsg);
        failed++;
        errors.push(`${ticker}: ${errorMsg}`);
      }
    }

    // Step 7: prezzi EU via Yahoo Finance
    if (euTickers.length > 0) {
      console.log(`--- Fetching ${euTickers.length} EU tickers via Yahoo Finance ---`);
      const { skipped: euSkipped } = await runWithConcurrency(
        euTickers,
        YAHOO_CONCURRENCY,
        (ticker) => processTicker(ticker, fetchYahooPrice, 'Yahoo'),
        withinBudget,
      );
      skipped += euSkipped.length;
      if (euSkipped.length > 0) {
        console.warn(`Budget esaurito: ${euSkipped.length} ticker EU rimandati al run successivo`);
      }
    }

    await flushPending(true);

    // Step 8: prezzi US. Nessuna attesa tra batch: la quota per run tiene la
    // singola invocazione entro il rate limit Finnhub (60 chiamate/minuto).
    if (usTickers.length > 0) {
      const label = useFinnhub ? 'Finnhub' : 'Yahoo-Fallback';
      console.log(`--- Fetching ${usTickers.length} US tickers via ${label} ---`);

      const fetcher = useFinnhub
        ? (ticker: string) => fetchFinnhubPrice(ticker, finnhubApiKey!)
        : (ticker: string) => fetchYahooPrice(ticker);

      const { skipped: usSkipped } = await runWithConcurrency(
        usTickers,
        useFinnhub ? FINNHUB_CONCURRENCY : YAHOO_CONCURRENCY,
        (ticker) => processTicker(ticker, fetcher, label),
        withinBudget,
      );
      skipped += usSkipped.length;
      if (usSkipped.length > 0) {
        console.warn(`Budget esaurito: ${usSkipped.length} ticker US rimandati al run successivo`);
      }
    }

    await flushPending(true);

    const deferred = (allEuTickers.length - euTickers.length)
      + (allUsTickers.length - usTickers.length)
      + skipped;

    const durationMs = Date.now() - startTime;
    console.log(`=== Cron Job Completed: ${updated} updated, ${failed} failed, ${deferred} deferred in ${durationMs}ms ===`);

    return new Response(
      JSON.stringify({
        success: true,
        updated,
        failed,
        deferred,
        total: uniqueTickers.length,
        eu_tickers: euTickers.length,
        us_tickers: usTickers.length,
        budget_exhausted: skipped > 0,
        duration_ms: durationMs,
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Cron job error:", errorMessage);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage,
        duration_ms: Date.now() - startTime
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
