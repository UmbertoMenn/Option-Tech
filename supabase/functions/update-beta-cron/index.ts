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

async function tradingViewBeta(ticker: string): Promise<number | null> {
  try {
    const sr = await fetch(
      `https://symbol-search.tradingview.com/symbol_search/?text=${encodeURIComponent(ticker)}&type=stock`,
      { headers: { "User-Agent": UA, "Origin": "https://www.tradingview.com", "Referer": "https://www.tradingview.com/" } },
    );
    if (!sr.ok) return null;
    const arr = await sr.json();
    const candidates = Array.isArray(arr)
      ? arr.filter((x: any) => String(x?.symbol || "").toUpperCase() === ticker.toUpperCase())
      : [];
    const match = candidates.find((x: any) => x?.is_primary_listing) || candidates[0] || (Array.isArray(arr) ? arr[0] : null);
    let prefix: string | undefined = match?.prefix || match?.source_id || match?.exchange;
    if (!prefix) return null;
    prefix = String(prefix).replace(/\s+/g, "").toUpperCase();
    const full = `${prefix}:${ticker.toUpperCase()}`;
    const sc = await fetch("https://scanner.tradingview.com/global/scan", {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/json", "Origin": "https://www.tradingview.com", "Referer": "https://www.tradingview.com/" },
      body: JSON.stringify({ symbols: { tickers: [full] }, columns: ["beta_1_year"] }),
    });
    if (!sc.ok) return null;
    const j = await sc.json();
    const v = j?.data?.[0]?.d?.[0];
    if (typeof v === "number" && isFinite(v) && Math.abs(v) < 10) return v;
    return null;
  } catch { return null; }
}

async function investingBeta(ticker: string): Promise<number | null> {
  try {
    const headers = {
      "User-Agent": UA,
      "Accept": "application/json, text/plain, */*",
      "Referer": "https://www.investing.com/",
      "X-Requested-With": "XMLHttpRequest",
      "domain-id": "www",
    };
    const sr = await fetch("https://www.investing.com/search/service/searchTopBar", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
      body: `search_text=${encodeURIComponent(ticker)}`,
    });
    if (!sr.ok) return null;
    const sj = await sr.json();
    const quotes: any[] = Array.isArray(sj?.quotes) ? sj.quotes : [];
    const match = quotes.find((q) => String(q?.symbol || "").toUpperCase() === ticker.toUpperCase()) || quotes[0];
    const link: string | undefined = match?.link;
    if (!link) return null;
    const pageUrl = link.startsWith("http") ? link : `https://www.investing.com${link}`;
    const pr = await fetch(pageUrl, {
      headers: { "User-Agent": UA, "Accept": "text/html", "Accept-Language": "en-US,en;q=0.9" },
    });
    if (!pr.ok) return null;
    const html = await pr.text();
    const patterns = [
      /Beta[^<>\n]{0,80}?<[^>]*>\s*(-?\d+\.\d+)/i,
      /"Beta"\s*[:,]\s*"?(-?\d+\.\d+)"?/i,
      />Beta<[\s\S]{0,200}?(-?\d+\.\d+)/i,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m) {
        const v = parseFloat(m[1]);
        if (isFinite(v) && Math.abs(v) < 10) return v;
      }
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

    // SINGLE SOURCE OF TRUTH: underlying_prices contiene tutti i ticker noti dell'app.
    // Quando viene aggiunto un nuovo ticker (Option Analyzer, derivatives, ecc.) finisce qui,
    // quindi il cron lo aggiornerà automaticamente al successivo run.
    // SINGLE SOURCE OF TRUTH: underlying_prices contiene tutti i ticker noti dell'app.
    // Inoltre, carichiamo i flag beta_manual per saltare i ticker con beta inserito manualmente.
    const [pricesRes, fundsRes] = await Promise.all([
      supabase.from("underlying_prices").select("ticker"),
      supabase.from("ticker_fundamentals").select("ticker, beta_manual"),
    ]);
    if (pricesRes.error) throw pricesRes.error;
    const manualSet = new Set<string>(
      (fundsRes.data || [])
        .filter((r: any) => r.beta_manual)
        .map((r: any) => String(r.ticker || "").toUpperCase()),
    );
    const tickers = Array.from(new Set((pricesRes.data ?? []).map((r: any) => String(r.ticker || "").trim().toUpperCase()).filter(Boolean))).sort();

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
        // Salta i ticker con beta inserito manualmente: non sovrascrivere mai.
        if (manualSet.has(ticker)) {
          stats.skipped++;
          continue;
        }

        const sum = await yahooSummary(ticker, auth);
        if (sum.status === 429 || sum.status >= 500) {
          delay = Math.min(MAX_DELAY, Math.floor(delay * 1.8));
          consecutiveOk = 0;
          await sleep(delay);
        }

        const s = sum.data;
        const yBeta: number | null =
          (typeof s?.defaultKeyStatistics?.beta?.raw === "number" && isFinite(s.defaultKeyStatistics.beta.raw))
            ? s.defaultKeyStatistics.beta.raw
            : (typeof s?.summaryDetail?.beta?.raw === "number" && isFinite(s.summaryDetail.beta.raw))
              ? s.summaryDetail.beta.raw
              : null;
        // Sempre interroga GuruFocus, TradingView e Investing per fare media con Yahoo
        const [gBeta, tvBeta, invBeta] = await Promise.all([
          guruFocusBeta(ticker),
          tradingViewBeta(ticker),
          investingBeta(ticker),
        ]);
        const parts: { name: string; v: number }[] = [];
        if (yBeta != null) parts.push({ name: "Yahoo", v: yBeta });
        if (gBeta != null) parts.push({ name: "GuruFocus", v: gBeta });
        if (tvBeta != null) parts.push({ name: "TradingView", v: tvBeta });
        if (invBeta != null) parts.push({ name: "Investing", v: invBeta });
        let beta: number | null = null;
        let betaSource: string = "";
        if (parts.length) {
          beta = parts.reduce((a, b) => a + b.v, 0) / parts.length;
          betaSource = parts.length === 1 && parts[0].name === "Yahoo"
            ? "Yahoo Finance"
            : parts.map((p) => p.name).join("+");
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
        if (beta != null) { update.beta = beta; update.beta_source = betaSource; update.beta_updated_at = now; }
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
