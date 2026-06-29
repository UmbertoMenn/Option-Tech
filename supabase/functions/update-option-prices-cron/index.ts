import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getThirdFriday(year: number, month: number): Date {
  const firstDay = new Date(year, month, 1);
  const firstFriday = 1 + ((5 - firstDay.getDay() + 7) % 7);
  return new Date(year, month, firstFriday + 14);
}

function buildOCCSymbol(ticker: string, expiryDate: string, optionType: string, strikePrice: number): string {
  const d = new Date(expiryDate);
  const thirdFri = getThirdFriday(d.getFullYear(), d.getMonth());
  const yy = thirdFri.getFullYear().toString().slice(-2);
  const mm = (thirdFri.getMonth() + 1).toString().padStart(2, '0');
  const dd = thirdFri.getDate().toString().padStart(2, '0');
  const type = optionType.toLowerCase() === 'call' ? 'C' : 'P';
  const strikeInt = Math.round(strikePrice * 1000);
  const strikeStr = strikeInt.toString().padStart(8, '0');
  return `${ticker}${yy}${mm}${dd}${type}${strikeStr}`;
}

interface PositionToUpdate {
  positionId: string;
  occSymbol: string;
  optionType: string;
  strikePrice: number;
  underlying: string;
}

interface GroupKey {
  ticker: string;
  expiryDate: string;
  thirdFridayUnix: number;
  positions: PositionToUpdate[];
}

// Obtain Yahoo crumb + cookie for authenticated API access
async function getYahooCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  try {
    // Step 1: Get cookie from Yahoo
    const initResp = await fetch('https://fc.yahoo.com', {
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    // Consume body to avoid resource leak
    await initResp.text();

    const setCookies = initResp.headers.get('set-cookie') || '';
    // Extract all cookies
    const cookies = setCookies.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');

    if (!cookies) {
      console.log('No cookies from Yahoo');
      return null;
    }

    // Step 2: Get crumb
    const crumbResp = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookies,
      },
    });

    if (!crumbResp.ok) {
      console.log(`Crumb request failed: ${crumbResp.status}`);
      await crumbResp.text();
      return null;
    }

    const crumb = await crumbResp.text();
    if (!crumb || crumb.length > 50) {
      console.log('Invalid crumb received');
      return null;
    }

    console.log(`Yahoo crumb obtained successfully (length=${crumb.length})`);
    return { crumb, cookie: cookies };
  } catch (error) {
    console.error('Error getting Yahoo crumb:', error);
    return null;
  }
}

// Fetch the full option chain for a ticker+expiry
async function fetchOptionChain(
  ticker: string,
  expiryUnix: number,
  crumb: string,
  cookie: string,
): Promise<{
  calls: Record<string, { bid: number; ask: number; lastPrice: number }>;
  puts: Record<string, { bid: number; ask: number; lastPrice: number }>;
} | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}?date=${expiryUnix}&crumb=${encodeURIComponent(crumb)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookie,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      console.log(`Yahoo v7 returned ${response.status} for ${ticker} date=${expiryUnix}: ${body.slice(0, 200)}`);
      return null;
    }

    const data = await response.json();
    const result = data.optionChain?.result?.[0];
    if (!result || !result.options || result.options.length === 0) {
      console.log(`No option chain data for ${ticker} date=${expiryUnix}`);
      return null;
    }

    const options = result.options[0];
    const calls: Record<string, { bid: number; ask: number; lastPrice: number }> = {};
    const puts: Record<string, { bid: number; ask: number; lastPrice: number }> = {};

    for (const c of (options.calls || [])) {
      calls[c.contractSymbol] = { bid: c.bid ?? 0, ask: c.ask ?? 0, lastPrice: c.lastPrice ?? 0 };
    }
    for (const p of (options.puts || [])) {
      puts[p.contractSymbol] = { bid: p.bid ?? 0, ask: p.ask ?? 0, lastPrice: p.lastPrice ?? 0 };
    }

    console.log(`[Yahoo v7] ${ticker} exp=${expiryUnix}: ${Object.keys(calls).length} calls, ${Object.keys(puts).length} puts`);
    return { calls, puts };
  } catch (error) {
    console.error(`Error fetching chain for ${ticker}:`, error);
    return null;
  }
}

function getMidPrice(contract: { bid: number; ask: number; lastPrice: number } | undefined, occSymbol: string): number | null {
  if (!contract) {
    console.log(`[Match] No contract found for ${occSymbol}`);
    return null;
  }
  if (contract.bid > 0 && contract.ask > 0) {
    const mid = (contract.bid + contract.ask) / 2;
    console.log(`[Price] ${occSymbol}: bid=${contract.bid}, ask=${contract.ask}, mid=${mid.toFixed(4)}`);
    return mid;
  }
  if (contract.lastPrice > 0) {
    console.log(`[Price] ${occSymbol}: lastPrice=${contract.lastPrice}`);
    return contract.lastPrice;
  }
  console.log(`[Price] ${occSymbol}: no mid/lastPrice from chain`);
  return null;
}

async function fetchFallbackPrice(occSymbol: string, crumb: string, cookie: string): Promise<number | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(occSymbol)}?crumb=${encodeURIComponent(crumb)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookie,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      console.log(`[Fallback] ${occSymbol}: v8/chart returned ${response.status}: ${body.slice(0, 200)}`);
      return null;
    }

    const data = await response.json();
    const meta = data.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;

    if (price && price > 0) {
      console.log(`[Price] ${occSymbol}: fallback regularMarketPrice=${price}`);
      return price;
    }

    console.log(`[Fallback] ${occSymbol}: no regularMarketPrice in v8 response`);
    return null;
  } catch (error) {
    console.error(`[Fallback] ${occSymbol}: error:`, error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("=== Update Option Prices Cron (v7/options) Started ===");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) throw new Error("Missing Supabase configuration");
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Step 0: Get Yahoo crumb for authenticated requests
    const auth = await getYahooCrumb();
    if (!auth) {
      throw new Error("Failed to obtain Yahoo Finance authentication crumb");
    }

    // Step 1: Get all active derivative positions
    const today = new Date().toISOString().split('T')[0];
    const { data: allDerivatives, error: derivError } = await supabase
      .from('positions')
      .select('id, underlying, option_type, strike_price, expiry_date, description')
      .eq('asset_type', 'derivative')
      .not('underlying', 'is', null)
      .not('option_type', 'is', null)
      .not('strike_price', 'is', null)
      .not('expiry_date', 'is', null)
      .gte('expiry_date', today);

    if (derivError) throw new Error(`Error fetching derivatives: ${derivError.message}`);

    if (!allDerivatives || allDerivatives.length === 0) {
      console.log("No active derivatives found");
      return new Response(
        JSON.stringify({ success: true, message: "No active derivatives", updated: 0, failed: 0, duration_ms: Date.now() - startTime }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter out EUREX/IDEM options — Yahoo doesn't support European option chains
    const eurexIdemSkipped = allDerivatives.filter(d => {
      const desc = (d.description || '').toUpperCase();
      return desc.startsWith('EUREX,') || desc.startsWith('IDEM,');
    });
    const derivatives = allDerivatives.filter(d => {
      const desc = (d.description || '').toUpperCase();
      return !desc.startsWith('EUREX,') && !desc.startsWith('IDEM,');
    });

    console.log(`Found ${allDerivatives.length} active derivatives: ${derivatives.length} US (will update), ${eurexIdemSkipped.length} EUREX/IDEM (skipped)`);
    if (eurexIdemSkipped.length > 0) {
      console.log(`Skipped EUREX/IDEM examples: ${eurexIdemSkipped.slice(0, 3).map(d => d.description).join('; ')}`);
    }

    if (derivatives.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "All derivatives are EUREX/IDEM, skipped", updated: 0, failed: 0, eurex_idem_skipped: eurexIdemSkipped.length, duration_ms: Date.now() - startTime }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 2: Resolve underlying -> ticker mappings (with canonical normalization)
    // Allineato a `normalizeUnderlying` di src/hooks/useUnderlyingMappings.ts:
    // case-insensitive, rimuove punteggiatura, spazi e suffissi societari.
    const normalizeUnderlying = (s: string): string =>
      s.toUpperCase()
        .replace(/[.,]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\b(INC|CORP|LTD|LLC|PLC|CO|THE)\b/g, '')
        .replace(/[^A-Z0-9]/g, '');

    const uniqueUnderlyings = [...new Set(derivatives.map(d => d.underlying).filter(Boolean))];

    // Carichiamo TUTTI i mapping e li indicizziamo per chiave normalizzata
    // (non possiamo filtrare server-side con .in() perché i nomi nelle positions
    // hanno casing/suffissi diversi rispetto a quelli in underlying_mappings).
    const { data: mappings, error: mapError } = await supabase
      .from('underlying_mappings')
      .select('underlying, ticker');

    if (mapError) console.error("Error fetching underlying_mappings:", mapError.message);

    const exactMap: Record<string, string> = {};
    const normalizedMap: Record<string, string> = {};
    mappings?.forEach(m => {
      exactMap[m.underlying] = m.ticker;
      const norm = normalizeUnderlying(m.underlying);
      if (norm && !normalizedMap[norm]) normalizedMap[norm] = m.ticker;
    });

    const underlyingToTicker: Record<string, string> = {};
    for (const u of uniqueUnderlyings) {
      const direct = exactMap[u];
      if (direct) { underlyingToTicker[u] = direct; continue; }
      const fallback = normalizedMap[normalizeUnderlying(u)];
      if (fallback) underlyingToTicker[u] = fallback;
    }
    console.log(`Resolved ${Object.keys(underlyingToTicker).length} / ${uniqueUnderlyings.length} underlyings to tickers (exact + normalized)`);

    // Step 3: Group positions by ticker + expiry month
    const groups: Record<string, GroupKey> = {};
    const skipped: string[] = [];

    for (const d of derivatives) {
      const ticker = underlyingToTicker[d.underlying];
      if (!ticker) {
        skipped.push(`${d.underlying} (no ticker mapping)`);
        continue;
      }

      const expDate = new Date(d.expiry_date);
      const thirdFri = getThirdFriday(expDate.getFullYear(), expDate.getMonth());
      const thirdFridayUnix = Math.floor(thirdFri.getTime() / 1000);
      const groupKey = `${ticker}_${expDate.getFullYear()}-${(expDate.getMonth() + 1).toString().padStart(2, '0')}`;

      const occSymbol = buildOCCSymbol(ticker, d.expiry_date, d.option_type, d.strike_price);

      if (!groups[groupKey]) {
        groups[groupKey] = { ticker, expiryDate: d.expiry_date, thirdFridayUnix, positions: [] };
      }
      groups[groupKey].positions.push({
        positionId: d.id,
        occSymbol,
        optionType: d.option_type,
        strikePrice: d.strike_price,
        underlying: d.underlying,
      });
    }

    if (skipped.length > 0) {
      console.log(`Skipped ${skipped.length} positions without ticker mapping: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '...' : ''}`);
    }

    const groupEntries = Object.entries(groups);
    console.log(`Grouped into ${groupEntries.length} ticker+expiry groups (covering ${derivatives.length - skipped.length} positions)`);

    // Step 4: Fetch option chains in batches
    const BATCH_SIZE = 20;
    const DELAY_BETWEEN_CALLS = 300;
    const DELAY_BETWEEN_BATCHES = 2000;

    const batches = chunkArray(groupEntries, BATCH_SIZE);
    let updated = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];

      if (batchIndex > 0) {
        console.log(`Pausing ${DELAY_BETWEEN_BATCHES}ms between batches (${batchIndex + 1}/${batches.length})...`);
        await delay(DELAY_BETWEEN_BATCHES);
      }

      console.log(`Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} groups)`);

      for (const [groupKey, group] of batch) {
        try {
          const chain = await fetchOptionChain(group.ticker, group.thirdFridayUnix, auth.crumb, auth.cookie);

          if (!chain) {
            for (const pos of group.positions) {
              failed++;
              errors.push(`${pos.occSymbol}: no chain data`);
            }
            await delay(DELAY_BETWEEN_CALLS);
            continue;
          }

          for (const pos of group.positions) {
            const isCall = pos.optionType.toLowerCase() === 'call';
            const contractMap = isCall ? chain.calls : chain.puts;
            const contract = contractMap[pos.occSymbol];
            let price = getMidPrice(contract, pos.occSymbol);

            // Fallback: try v8/chart for regularMarketPrice
            if (price === null) {
              await delay(DELAY_BETWEEN_CALLS);
              price = await fetchFallbackPrice(pos.occSymbol, auth.crumb, auth.cookie);
            }

            if (price !== null) {
              const { error: updateError } = await supabase
                .from('positions')
                .update({ current_price: price, updated_at: new Date().toISOString() })
                .eq('id', pos.positionId);

              if (updateError) {
                console.error(`Failed to update ${pos.positionId}:`, updateError.message);
                failed++;
                errors.push(`${pos.occSymbol}: update failed`);
              } else {
                updated++;
              }
            } else {
              console.log(`[Price] ${pos.occSymbol}: FAILED - no price from chain or fallback`);
              failed++;
              errors.push(`${pos.occSymbol}: no price data (chain+fallback)`);
            }
          }

          await delay(DELAY_BETWEEN_CALLS);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`Error processing group ${groupKey}:`, errorMsg);
          for (const pos of group.positions) {
            failed++;
            errors.push(`${pos.occSymbol}: ${errorMsg}`);
          }
        }
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(`=== Option Prices Cron Completed: ${updated} updated, ${failed} failed, ${skipped.length} skipped in ${durationMs}ms ===`);

    return new Response(
      JSON.stringify({
        success: true,
        updated,
        failed,
        skipped: skipped.length,
        eurex_idem_skipped: eurexIdemSkipped.length,
        total: allDerivatives.length,
        groups: groupEntries.length,
        duration_ms: durationMs,
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Cron job error:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage, duration_ms: Date.now() - startTime }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
