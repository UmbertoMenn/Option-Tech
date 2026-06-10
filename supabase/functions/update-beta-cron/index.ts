import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36";

// Map currency -> 10y yield ticker on Yahoo
const RF_TICKER: Record<string, string> = {
  USD: "^TNX",
  EUR: "IT10Y.B",
  GBP: "GB10Y.B",
  CHF: "CH10YT=RR",
  JPY: "JP10Y.B",
  CAD: "CA10YT=RR",
};

async function getYahooCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  try {
    const initResp = await fetch("https://fc.yahoo.com", {
      redirect: "manual",
      headers: { "User-Agent": UA },
    });
    await initResp.text();
    const setCookies = initResp.headers.get("set-cookie") || "";
    const cookies = setCookies.split(",").map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
    if (!cookies) return null;
    const crumbResp = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Cookie: cookies },
    });
    if (!crumbResp.ok) { await crumbResp.text(); return null; }
    const crumb = await crumbResp.text();
    if (!crumb || crumb.length > 50) return null;
    return { crumb, cookie: cookies };
  } catch { return null; }
}

function yahooHeaders(auth: { cookie: string } | null) {
  const h: Record<string, string> = { "User-Agent": UA };
  if (auth?.cookie) h.Cookie = auth.cookie;
  return h;
}

type FetchOutcome<T> = { data: T | null; status: number };

async function yahooFetchJson<T = any>(url: string, auth: { cookie: string } | null): Promise<FetchOutcome<T>> {
  try {
    const r = await fetch(url, { headers: yahooHeaders(auth) });
    if (!r.ok) { await r.text(); return { data: null, status: r.status }; }
    const j = await r.json();
    return { data: j as T, status: 200 };
  } catch { return { data: null, status: 0 }; }
}

async function yahooQuote(ticker: string, auth: { crumb: string; cookie: string } | null) {
  const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}${auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : ""}`;
  const { data, status } = await yahooFetchJson<any>(url, auth);
  return { data: data?.quoteResponse?.result?.[0] ?? null, status };
}

async function yahooSummary(ticker: string, auth: { crumb: string; cookie: string } | null) {
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=defaultKeyStatistics,summaryDetail,price${auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : ""}`;
  const { data, status } = await yahooFetchJson<any>(url, auth);
  return { data: data?.quoteSummary?.result?.[0] ?? null, status };
}

async function yahooChart1y(ticker: string, auth: { crumb: string; cookie: string } | null): Promise<{ closes: number[] | null; status: number }> {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d${auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : ""}`;
  const { data, status } = await yahooFetchJson<any>(url, auth);
  const raw: (number | null)[] = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  const closes = raw.filter((x): x is number => typeof x === "number" && x > 0);
  return { closes: closes.length ? closes : null, status };
}

function annualizedVol(closes: number[]): number | null {
  if (closes.length < 30) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // SINGLE SOURCE OF TRUTH: underlying_prices contiene tutti i ticker noti dell'app.
    // Quando viene aggiunto un nuovo ticker (Option Analyzer, derivatives, ecc.) finisce qui,
    // quindi il cron lo aggiornerà automaticamente al successivo run.
    const { data: rows, error } = await supabase
      .from("underlying_prices")
      .select("ticker");
    if (error) throw error;

    const tickers = Array.from(new Set((rows ?? []).map((r: any) => String(r.ticker || "").trim().toUpperCase()).filter(Boolean))).sort();

    const auth = await getYahooCrumb();
    if (!auth) {
      return new Response(JSON.stringify({ error: "Yahoo auth failed" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Adaptive throttling
    let delay = 300;                 // ms between calls
    const MIN_DELAY = 200;
    const MAX_DELAY = 5000;
    let consecutiveOk = 0;

    const stats = { scanned: tickers.length, updated: 0, skipped: 0, errors: 0 as number };
    const errors: { ticker: string; reason: string }[] = [];
    const now = new Date().toISOString();

    for (const ticker of tickers) {
      try {
        const sum = await yahooSummary(ticker, auth);
        if (sum.status === 429 || sum.status >= 500) {
          delay = Math.min(MAX_DELAY, Math.floor(delay * 1.8));
          consecutiveOk = 0;
          await sleep(delay);
        }

        const s = sum.data;
        let beta: number | null =
          (typeof s?.defaultKeyStatistics?.beta?.raw === "number" && isFinite(s.defaultKeyStatistics.beta.raw))
            ? s.defaultKeyStatistics.beta.raw
            : (typeof s?.summaryDetail?.beta?.raw === "number" && isFinite(s.summaryDetail.beta.raw))
              ? s.summaryDetail.beta.raw
              : null;
        let betaSource: string = "Yahoo Finance";
        // Fallback GuruFocus se Yahoo non ha Beta
        if (beta == null) {
          const gf = await guruFocusBeta(ticker);
          if (gf != null) { beta = gf; betaSource = "GuruFocus"; }
        }
        const name: string | null = s?.price?.longName ?? s?.price?.shortName ?? null;
        const currency: string | null = s?.price?.currency ?? null;
        const priceFromSummary: number | null =
          (typeof s?.price?.regularMarketPrice?.raw === "number") ? s.price.regularMarketPrice.raw : null;

        // Chart for RV (also gives last close if summary missed price)
        const chart = await yahooChart1y(ticker, auth);
        if (chart.status === 429 || chart.status >= 500) {
          delay = Math.min(MAX_DELAY, Math.floor(delay * 1.8));
          consecutiveOk = 0;
          await sleep(delay);
        }
        const rv = chart.closes ? annualizedVol(chart.closes) : null;
        const price = priceFromSummary ?? (chart.closes ? chart.closes[chart.closes.length - 1] : null);

        // Risk free per currency (best effort)
        let riskFree: number | null = null;
        const rfTk = RF_TICKER[currency || "USD"] ?? "^TNX";
        const rf = await yahooQuote(rfTk, auth);
        if (typeof rf.data?.regularMarketPrice === "number") riskFree = rf.data.regularMarketPrice;

        const update: Record<string, any> = { ticker, updated_at: now };
        if (beta != null) { update.beta = beta; update.beta_source = "Yahoo Finance"; update.beta_updated_at = now; }
        if (rv != null)   { update.rv = rv; update.rv_updated_at = now; }
        if (name)         update.name = name;
        if (currency)     update.currency = currency;
        if (price != null) update.price = price;
        if (riskFree != null) update.risk_free = riskFree;

        // Only upsert when we actually have at least one fresh data point
        if (Object.keys(update).length > 2) {
          const { error: upErr } = await supabase
            .from("ticker_fundamentals")
            .upsert(update, { onConflict: "ticker" });
          if (upErr) { stats.errors++; errors.push({ ticker, reason: upErr.message }); }
          else stats.updated++;
        } else {
          stats.skipped++;
        }

        // Adaptive: success path slowly relaxes delay
        consecutiveOk++;
        if (consecutiveOk >= 5 && delay > MIN_DELAY) {
          delay = Math.max(MIN_DELAY, Math.floor(delay * 0.9));
          consecutiveOk = 0;
        }
        await sleep(delay);
      } catch (e: any) {
        stats.errors++;
        errors.push({ ticker, reason: String(e?.message || e) });
        delay = Math.min(MAX_DELAY, Math.floor(delay * 1.5));
        await sleep(delay);
      }
    }

    return new Response(JSON.stringify({ ...stats, finalDelayMs: delay, sampleErrors: errors.slice(0, 10) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as any)?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
