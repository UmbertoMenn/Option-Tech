import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Result {
  ticker: string;
  name: string | null;
  currency: string | null;
  price: number | null;
  beta: number | null;
  betaSource: string | null;
  rv: number | null;
  riskFree: number | null;
  erp: number | null;
  erpCountry: string | null;
  asof: string;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36";

// Valid ticker: uppercase letters/digits, dot, dash, caret, equals. Max ~12 chars.
const VALID_TICKER_RE = /^[A-Z0-9.\-^=]{1,12}$/;

const RF_TICKER: Record<string, string> = {
  USD: "^TNX", EUR: "IT10Y.B", GBP: "GB10Y.B", CHF: "CH10YT=RR", JPY: "JP10Y.B", CAD: "CA10YT=RR",
};
const CURRENCY_TO_COUNTRY: Record<string, string> = {
  USD: "United States", EUR: "Italy", GBP: "United Kingdom", CHF: "Switzerland", JPY: "Japan", CAD: "Canada",
};

async function getYahooCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  try {
    const initResp = await fetch("https://fc.yahoo.com", { redirect: "manual", headers: { "User-Agent": UA } });
    await initResp.text();
    const setCookies = initResp.headers.get("set-cookie") || "";
    const cookies = setCookies.split(",").map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
    if (!cookies) return null;
    const crumbResp = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": UA, Cookie: cookies } });
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

async function yahooQuote(ticker: string, auth: { crumb: string; cookie: string } | null) {
  try {
    const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}${auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : ""}`;
    const r = await fetch(url, { headers: yahooHeaders(auth) });
    if (!r.ok) { await r.text(); return null; }
    const j = await r.json();
    return j?.quoteResponse?.result?.[0] ?? null;
  } catch { return null; }
}

async function yahooSummary(ticker: string, auth: { crumb: string; cookie: string } | null) {
  try {
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=defaultKeyStatistics,summaryDetail,price${auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : ""}`;
    const r = await fetch(url, { headers: yahooHeaders(auth) });
    if (!r.ok) { await r.text(); return null; }
    const j = await r.json();
    return j?.quoteSummary?.result?.[0] ?? null;
  } catch { return null; }
}

async function yahooChart1y(ticker: string, auth: { crumb: string; cookie: string } | null): Promise<number[] | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d${auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : ""}`;
    const r = await fetch(url, { headers: yahooHeaders(auth) });
    if (!r.ok) { await r.text(); return null; }
    const j = await r.json();
    const closes: (number | null)[] = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    return closes.filter((x): x is number => typeof x === "number" && x > 0);
  } catch { return null; }
}

async function finnhubQuote(ticker: string): Promise<{ price: number | null; name: string | null; currency: string | null }> {
  const key = Deno.env.get("FINNHUB_API_KEY");
  if (!key) return { price: null, name: null, currency: null };
  try {
    const [qResp, pResp] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${key}`),
      fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${key}`),
    ]);
    const q = qResp.ok ? await qResp.json() : null;
    const p = pResp.ok ? await pResp.json() : null;
    const price = q?.c && q.c > 0 ? Number(q.c) : null;
    return { price, name: p?.name ?? null, currency: p?.currency ?? null };
  } catch { return { price: null, name: null, currency: null }; }
}

function annualizedVol(closes: number[]): number | null {
  if (closes.length < 30) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
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

/**
 * Combina Beta Yahoo + GuruFocus + TradingView + Investing con media semplice.
 *  - source elenca le fonti contributrici, es. "Yahoo+GuruFocus+TradingView+Investing"
 */
function combineBeta(
  yahoo: number | null,
  guru: number | null,
  tv: number | null,
  inv: number | null,
): { beta: number | null; source: string | null } {
  const parts: { name: string; v: number }[] = [];
  if (typeof yahoo === "number" && isFinite(yahoo)) parts.push({ name: "Yahoo", v: yahoo });
  if (typeof guru === "number" && isFinite(guru)) parts.push({ name: "GuruFocus", v: guru });
  if (typeof tv === "number" && isFinite(tv)) parts.push({ name: "TradingView", v: tv });
  if (typeof inv === "number" && isFinite(inv)) parts.push({ name: "Investing", v: inv });
  if (!parts.length) return { beta: null, source: null };
  const avg = parts.reduce((a, b) => a + b.v, 0) / parts.length;
  const src = parts.length === 1 && parts[0].name === "Yahoo"
    ? "Yahoo Finance"
    : parts.map((p) => p.name).join("+");
  return { beta: avg, source: src };
}

async function fetchERPDamodaran(): Promise<Record<string, { erp: number; currency?: string }>> {
  try {
    const r = await fetch("https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ctryprem.html", { headers: { "User-Agent": UA } });
    if (!r.ok) return {};
    const html = await r.text();
    const out: Record<string, { erp: number }> = {};
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(html))) {
      const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
        c[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim()
      );
      if (cells.length < 3) continue;
      const country = cells[0];
      let erpStr: string | null = null;
      for (let i = cells.length - 1; i >= 1; i--) {
        const c = cells[i].replace(",", ".");
        const mm = c.match(/^(-?\d+\.\d+)\s*%?$/);
        if (mm) { erpStr = mm[1]; break; }
      }
      if (country && erpStr) {
        const v = parseFloat(erpStr);
        if (isFinite(v) && v > 0 && v < 50) out[country] = { erp: v };
      }
    }
    return out;
  } catch { return {}; }
}

async function getCachedFundamental(supabase: any, ticker: string) {
  const { data } = await supabase.from("ticker_fundamentals").select("*").eq("ticker", ticker).maybeSingle();
  return data;
}
async function upsertFundamental(supabase: any, row: any) {
  await supabase.from("ticker_fundamentals").upsert(row, { onConflict: "ticker" });
}
async function getCachedERP(supabase: any, country: string) {
  const { data } = await supabase.from("equity_risk_premiums").select("*").eq("country", country).maybeSingle();
  return data;
}
async function upsertERPs(supabase: any, all: Record<string, { erp: number }>) {
  const rows = Object.entries(all).map(([country, v]) => ({
    country, erp_pct: v.erp, source: "Damodaran", updated_at: new Date().toISOString(),
  }));
  if (rows.length) await supabase.from("equity_risk_premiums").upsert(rows, { onConflict: "country" });
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth gate: allow CRON_SECRET header OR a valid authenticated JWT.
  {
    const cronSecret = Deno.env.get("CRON_SECRET");
    const providedSecret = req.headers.get("x-cron-secret");
    const isCron = !!cronSecret && providedSecret === cronSecret;
    let isAuthed = false;
    const authHeader = req.headers.get("Authorization");
    if (!isCron && authHeader?.startsWith("Bearer ")) {
      try {
        const sbAuth = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
        );
        const { data: claimsData } = await sbAuth.auth.getClaims(authHeader.replace("Bearer ", ""));
        isAuthed = !!claimsData?.claims?.sub;
      } catch (_) { /* ignore */ }
    }
    if (!isCron && !isAuthed) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  try {

    const { ticker: rawTicker, force } = await req.json();
    const ticker = String(rawTicker || "").trim().toUpperCase();

    // VALIDAZIONE: solo ticker puliti, niente "APPLE COMPUTER, INC."
    if (!ticker || !VALID_TICKER_RE.test(ticker)) {
      return new Response(
        JSON.stringify({ error: "Invalid ticker (must be a clean symbol, e.g. AAPL)", ticker: rawTicker }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const cached = await getCachedFundamental(supabase, ticker);
    const now = Date.now();

    const auth = await getYahooCrumb();

    // 1. Price + name + currency
    const q = await yahooQuote(ticker, auth);
    let price: number | null = q?.regularMarketPrice ?? null;
    let name: string | null = q?.longName ?? q?.shortName ?? null;
    let currency: string | null = q?.currency ?? null;

    if (price == null || name == null || currency == null) {
      const fh = await finnhubQuote(ticker);
      if (price == null) price = fh.price;
      if (name == null) name = fh.name;
      if (currency == null) currency = fh.currency;
    }
    name = name ?? cached?.name ?? null;
    currency = currency ?? cached?.currency ?? "USD";

    // 2. Beta — media Yahoo + GuruFocus + TradingView (refresh mensile, o force).
    // RISPETTA il flag beta_manual: se admin ha inserito beta a mano, NON sovrascrivere.
    let beta: number | null = cached?.beta ?? null;
    let betaSource: string | null = cached?.beta_source ?? null;
    let betaUpdatedAt = cached?.beta_updated_at ? new Date(cached.beta_updated_at).getTime() : 0;
    const isManual = !!cached?.beta_manual;
    if (!isManual && (force || beta == null || now - betaUpdatedAt > MONTH_MS)) {
      const sum = await yahooSummary(ticker, auth);
      const yBeta: number | null =
        (typeof sum?.defaultKeyStatistics?.beta?.raw === "number" && isFinite(sum.defaultKeyStatistics.beta.raw))
          ? sum.defaultKeyStatistics.beta.raw
          : (typeof sum?.summaryDetail?.beta?.raw === "number" && isFinite(sum.summaryDetail.beta.raw))
            ? sum.summaryDetail.beta.raw
            : null;
      const [gBeta, tvBeta, invBeta] = await Promise.all([guruFocusBeta(ticker), tradingViewBeta(ticker), investingBeta(ticker)]);
      const combined = combineBeta(yBeta, gBeta, tvBeta, invBeta);
      if (combined.beta != null) {
        beta = combined.beta;
        betaSource = combined.source;
        betaUpdatedAt = now;
      }
    }

    // 3. RV — refresh giornaliero
    let rv: number | null = cached?.rv ?? null;
    let rvUpdatedAt = cached?.rv_updated_at ? new Date(cached.rv_updated_at).getTime() : 0;
    if (!rv || now - rvUpdatedAt > DAY_MS) {
      const closes = await yahooChart1y(ticker, auth);
      if (closes) {
        const v = annualizedVol(closes);
        if (v != null) { rv = v; rvUpdatedAt = now; }
      }
    }

    // 4. Risk-free
    let riskFree: number | null = null;
    const rfTk = RF_TICKER[currency] ?? "^TNX";
    const rfQ = await yahooQuote(rfTk, auth);
    if (rfQ?.regularMarketPrice != null) riskFree = Number(rfQ.regularMarketPrice);
    if (riskFree == null && currency !== "USD") {
      const us = await yahooQuote("^TNX", auth);
      if (us?.regularMarketPrice != null) riskFree = Number(us.regularMarketPrice);
    }

    // 5. ERP
    const country = CURRENCY_TO_COUNTRY[currency] ?? "United States";
    let erpRow = await getCachedERP(supabase, country);
    if (!erpRow || now - new Date(erpRow.updated_at).getTime() > DAY_MS) {
      const all = await fetchERPDamodaran();
      if (Object.keys(all).length) {
        await upsertERPs(supabase, all);
        erpRow = await getCachedERP(supabase, country);
      }
    }
    const erp = erpRow?.erp_pct != null ? Number(erpRow.erp_pct) : null;

    await upsertFundamental(supabase, {
      ticker, name, currency, beta, beta_source: betaSource, rv, risk_free: riskFree, price,
      beta_updated_at: new Date(betaUpdatedAt || now).toISOString(),
      rv_updated_at: new Date(rvUpdatedAt || now).toISOString(),
      updated_at: new Date().toISOString(),
    });

    const result: Result = {
      ticker, name, currency, price, beta, betaSource, rv, riskFree, erp,
      erpCountry: country, asof: new Date().toISOString().slice(0, 10),
    };
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as any)?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
