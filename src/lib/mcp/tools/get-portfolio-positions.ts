import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export default defineTool({
  name: "get_portfolio_positions",
  title: "Posizioni del portafoglio",
  description:
    "Restituisce le posizioni (azioni, ETF, obbligazioni, derivati) di uno specifico portafoglio dell'utente.",
  inputSchema: {
    portfolio_id: z
      .string()
      .uuid()
      .describe("UUID del portafoglio da leggere (recuperabile via list_portfolios)."),
    asset_type: z
      .string()
      .optional()
      .describe(
        "Filtro opzionale sul tipo di asset (es. STOCK, ETF, BOND, OPTION).",
      ),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ portfolio_id, asset_type }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Non autenticato" }], isError: true };
    }
    let query = supabaseForUser(ctx)
      .from("positions")
      .select(
        "id, asset_type, description, isin, quantity, avg_cost, current_price, market_value, profit_loss, profit_loss_pct, currency, expiry_date, option_type",
      )
      .eq("portfolio_id", portfolio_id);

    if (asset_type) query = query.eq("asset_type", asset_type);

    const { data, error } = await query;
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { positions: data ?? [] },
    };
  },
});
