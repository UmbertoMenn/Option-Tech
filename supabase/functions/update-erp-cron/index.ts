import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  if (!(await isAuthorizedCronRequest(req))) {
    return unauthorizedCronResponse();
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
    return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
