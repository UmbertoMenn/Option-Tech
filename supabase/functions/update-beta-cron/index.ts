import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36";

async function yahooSummary(ticker: string) {
  try {
    const r = await fetch(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=defaultKeyStatistics,summaryDetail`,
      { headers: { "User-Agent": UA } }
    );
    if (!r.ok) return null;
    const j = await r.json();
    return j?.quoteSummary?.result?.[0] ?? null;
  } catch { return null; }
}

async function guruFocusBeta(ticker: string): Promise<number | null> {
  try {
    const r = await fetch(`https://www.gurufocus.com/term/beta/${encodeURIComponent(ticker)}`, {
      headers: { "User-Agent": UA },
    });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/Beta[^<>]{0,40}?(-?\d+\.\d+)/i);
    if (m) {
      const v = parseFloat(m[1]);
      if (isFinite(v) && Math.abs(v) < 10) return v;
    }
    return null;
  } catch { return null; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: rows } = await supabase.from("ticker_fundamentals").select("ticker");
    const tickers: string[] = (rows ?? []).map((r: any) => r.ticker);
    let updated = 0;
    for (const ticker of tickers) {
      const sum = await yahooSummary(ticker);
      let beta: number | null = sum?.defaultKeyStatistics?.beta?.raw ?? sum?.summaryDetail?.beta?.raw ?? null;
      let source = "Yahoo Finance";
      if (typeof beta !== "number" || !isFinite(beta)) {
        const gf = await guruFocusBeta(ticker);
        if (gf != null) { beta = gf; source = "GuruFocus"; } else { continue; }
      }
      await supabase.from("ticker_fundamentals").update({
        beta, beta_source: source,
        beta_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("ticker", ticker);
      updated++;
      // gentle rate-limit
      await new Promise((r) => setTimeout(r, 250));
    }
    return new Response(JSON.stringify({ scanned: tickers.length, updated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
