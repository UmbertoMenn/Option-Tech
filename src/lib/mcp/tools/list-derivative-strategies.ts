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
  name: "list_derivative_strategies",
  title: "Strategie derivati",
  description:
    "Elenca le configurazioni di strategie derivati (Covered Call, Put, Spread, ecc.) mappate per un portafoglio.",
  inputSchema: {
    portfolio_id: z
      .string()
      .uuid()
      .describe("UUID del portafoglio."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ portfolio_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Non autenticato" }], isError: true };
    }
    const { data, error } = await supabaseForUser(ctx)
      .from("strategy_configurations")
      .select("*")
      .eq("portfolio_id", portfolio_id);

    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { strategies: data ?? [] },
    };
  },
});
