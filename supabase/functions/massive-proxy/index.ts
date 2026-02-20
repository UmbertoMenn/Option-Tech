import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MASSIVE_BASE = "https://api.polygon.io"; // massive.com uses Polygon-compatible API

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check: must be admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } =
      await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub as string;

    // Check admin role
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const MASSIVE_API_KEY = Deno.env.get("MASSIVE_API_KEY");
    if (!MASSIVE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "MASSIVE_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const url = new URL(req.url);
    const op = url.searchParams.get("op");
    const ticker = url.searchParams.get("ticker") || "";
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const expirationDate = url.searchParams.get("expiration_date") || "";

    let apiUrl: string;
    let allResults: unknown[] = [];

    switch (op) {
      case "stock-bars": {
        apiUrl = `${MASSIVE_BASE}/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc&apiKey=${MASSIVE_API_KEY}`;
        const data = await fetchWithPagination(apiUrl, MASSIVE_API_KEY);
        return jsonResponse(data);
      }

      case "option-contracts": {
        apiUrl = `${MASSIVE_BASE}/v3/reference/options/contracts?underlying_ticker=${ticker}&expiration_date=${expirationDate}&limit=250&apiKey=${MASSIVE_API_KEY}`;
        allResults = await fetchWithPaginationV3(apiUrl, MASSIVE_API_KEY);
        return jsonResponse(allResults);
      }

      case "option-bars": {
        apiUrl = `${MASSIVE_BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${from}/${to}?adjusted=true&sort=asc&apiKey=${MASSIVE_API_KEY}`;
        const data = await fetchWithPagination(apiUrl, MASSIVE_API_KEY);
        return jsonResponse(data);
      }

      case "option-chain": {
        apiUrl = `${MASSIVE_BASE}/v3/snapshot/options/${ticker}?expiration_date=${expirationDate}&limit=250&apiKey=${MASSIVE_API_KEY}`;
        allResults = await fetchWithPaginationV3(apiUrl, MASSIVE_API_KEY);
        return jsonResponse(allResults);
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown operation: ${op}` }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
    }
  } catch (error) {
    console.error("massive-proxy error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// V2 pagination (aggs): results are in .results, next_url in root
async function fetchWithPagination(
  initialUrl: string,
  apiKey: string
): Promise<unknown[]> {
  let allResults: unknown[] = [];
  let nextUrl: string | null = initialUrl;
  let retries = 0;

  while (nextUrl) {
    const res = await fetch(nextUrl);

    if (res.status === 429) {
      retries++;
      if (retries > 5) throw new Error("Rate limited by Massive.com API");
      await new Promise((r) => setTimeout(r, 1000 * retries));
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Massive API error ${res.status}: ${body}`);
    }

    const json = await res.json();
    if (json.results) allResults = allResults.concat(json.results);
    nextUrl = json.next_url
      ? `${json.next_url}&apiKey=${apiKey}`
      : null;
    retries = 0;
  }

  return allResults;
}

// V3 pagination: results are in .results, next_url in root
async function fetchWithPaginationV3(
  initialUrl: string,
  apiKey: string
): Promise<unknown[]> {
  let allResults: unknown[] = [];
  let nextUrl: string | null = initialUrl;
  let retries = 0;

  while (nextUrl) {
    const res = await fetch(nextUrl);

    if (res.status === 429) {
      retries++;
      if (retries > 5) throw new Error("Rate limited by Massive.com API");
      await new Promise((r) => setTimeout(r, 1000 * retries));
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Massive API error ${res.status}: ${body}`);
    }

    const json = await res.json();
    if (json.results) allResults = allResults.concat(json.results);
    nextUrl = json.next_url
      ? `${json.next_url}&apiKey=${apiKey}`
      : null;
    retries = 0;
  }

  return allResults;
}
