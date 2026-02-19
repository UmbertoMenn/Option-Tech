import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch all portfolios with a snapshot_date
    const { data: portfolios, error: pErr } = await supabase
      .from("portfolios")
      .select("id, snapshot_date, user_id")
      .not("snapshot_date", "is", null);

    if (pErr) throw pErr;

    let created = 0;
    let skipped = 0;
    const warnings: string[] = [];

    for (const portfolio of portfolios ?? []) {
      const snapshotDate = portfolio.snapshot_date;

      // Get the latest historical_data entry for this portfolio
      const { data: latestHist } = await supabase
        .from("historical_data")
        .select("snapshot_date")
        .eq("portfolio_id", portfolio.id)
        .order("snapshot_date", { ascending: false })
        .limit(1)
        .single();

      // Skip if already have a snapshot for this date or later
      if (latestHist && latestHist.snapshot_date >= snapshotDate) {
        skipped++;
        continue;
      }

      // Get staged values from portfolio_latest_values
      const { data: staged } = await supabase
        .from("portfolio_latest_values")
        .select("*")
        .eq("portfolio_id", portfolio.id)
        .single();

      if (!staged) {
        warnings.push(`Portfolio ${portfolio.id}: no staged values, skipping`);
        skipped++;
        continue;
      }

      // Check if staged data is too old (>48h)
      const stagedAge =
        Date.now() - new Date(staged.updated_at).getTime();
      if (stagedAge > 48 * 60 * 60 * 1000) {
        warnings.push(
          `Portfolio ${portfolio.id}: staged values older than 48h, skipping`
        );
        skipped++;
        continue;
      }

      // Create the historical_data record
      const { error: insertErr } = await supabase
        .from("historical_data")
        .upsert(
          {
            portfolio_id: portfolio.id,
            snapshot_date: snapshotDate,
            total_value: staged.total_value,
            netting_total: staged.netting_total,
            netting_ex_cc: staged.netting_ex_cc_np, // mapped for compatibility
            netting_ex_cc_np: staged.netting_ex_cc_np,
            equity_exposure_pct: staged.equity_exposure_pct,
            usd_exposure_pct: staged.usd_exposure_pct,
            deposits: 0,
            average_balance: 0,
          },
          { onConflict: "portfolio_id,snapshot_date" }
        );

      if (insertErr) {
        warnings.push(
          `Portfolio ${portfolio.id}: insert error: ${insertErr.message}`
        );
        skipped++;
      } else {
        created++;
      }
    }

    const result = {
      created,
      skipped,
      total: portfolios?.length ?? 0,
      warnings,
    };

    console.log("Auto-snapshot result:", JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Auto-snapshot error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
