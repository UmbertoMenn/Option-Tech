import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36";

async function fetchERPDamodaran(): Promise<Record<string, number>> {
  const r = await fetch("https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ctryprem.html", {
    headers: { "User-Agent": UA },
  });
  if (!r.ok) throw new Error(`Damodaran HTTP ${r.status}`);
  const html = await r.text();
  const out: Record<string, number> = {};
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
      if (isFinite(v) && v > 0 && v < 50) out[country] = v;
    }
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const all = await fetchERPDamodaran();
    const rows = Object.entries(all).map(([country, erp]) => ({
      country, erp_pct: erp, source: "Damodaran", updated_at: new Date().toISOString(),
    }));
    if (rows.length) await supabase.from("equity_risk_premiums").upsert(rows, { onConflict: "country" });
    return new Response(JSON.stringify({ updated: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
