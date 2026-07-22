import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Operation =
  | "health"
  | "stock-eod"
  | "option-contracts"
  | "option-eod"
  | "option-quotes"
  | "option-eod-greeks";

interface RequestBody {
  operation?: Operation;
  symbol?: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  expiration?: string;
  strike?: number | "*";
  right?: "call" | "put" | "both";
  interval?: "1m" | "5m" | "15m" | "30m" | "1h";
  maxDte?: number;
  strikeRange?: number;
}

class RequestError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "INVALID_REQUEST") {
    super(message);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405, "METHOD_NOT_ALLOWED");

  try {
    await requireAdmin(req);
    const body = await parseBody(req);

    const baseUrl = Deno.env.get("THETADATA_BASE_URL")?.replace(/\/+$/, "");
    if (!baseUrl) {
      const unavailable = {
        connected: false,
        provider: "thetadata",
        apiVersion: "v3",
        baseUrlConfigured: false,
        message: "THETADATA_BASE_URL non configurato",
      };
      return body.operation === "health"
        ? jsonResponse(unavailable)
        : jsonResponse({ ...unavailable, error: unavailable.message, code: "THETADATA_NOT_CONFIGURED" }, 503);
    }

    const { path, params } = buildThetaDataRequest(body);
    const url = new URL(`${baseUrl}${path}`);
    params.set("format", "json");
    params.forEach((value, key) => url.searchParams.set(key, value));

    const headers = new Headers({ Accept: "application/json" });
    const gatewayToken = Deno.env.get("THETADATA_GATEWAY_TOKEN");
    if (gatewayToken) headers.set("Authorization", `Bearer ${gatewayToken}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let response: Response;
    try {
      response = await fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    const raw = await response.text();
    if (!response.ok) {
      return errorResponse(
        `ThetaData ${response.status}: ${raw.slice(0, 500)}`,
        response.status === 404 ? 404 : 502,
        "THETADATA_ERROR",
      );
    }

    let data: unknown;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      throw new RequestError("ThetaData non ha restituito JSON valido", 502, "INVALID_PROVIDER_RESPONSE");
    }

    if (body.operation === "health") {
      return jsonResponse({
        connected: true,
        provider: "thetadata",
        apiVersion: "v3",
        baseUrlConfigured: true,
        schedule: data,
      });
    }

    return jsonResponse({ data, provider: "thetadata", apiVersion: "v3" });
  } catch (error) {
    console.error("thetadata-proxy error:", error);
    if (error instanceof RequestError) return errorResponse(error.message, error.status, error.code);
    if (error instanceof DOMException && error.name === "AbortError") {
      return errorResponse("ThetaData timeout", 504, "THETADATA_TIMEOUT");
    }
    return errorResponse(error instanceof Error ? error.message : "Unknown error", 500, "INTERNAL_ERROR");
  }
});

async function requireAdmin(req: Request): Promise<void> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new RequestError("Unauthorized", 401, "UNAUTHORIZED");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(authHeader.slice(7));
  if (claimsError || !claimsData?.claims?.sub) throw new RequestError("Unauthorized", 401, "UNAUTHORIZED");

  const { data: roleData, error: roleError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", claimsData.claims.sub)
    .eq("role", "admin")
    .maybeSingle();
  if (roleError || !roleData) throw new RequestError("Admin only", 403, "ADMIN_ONLY");
}

async function parseBody(req: Request): Promise<RequestBody> {
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    throw new RequestError("Body JSON non valido");
  }
  if (!body.operation) throw new RequestError("operation obbligatoria");
  return body;
}

function buildThetaDataRequest(body: RequestBody): { path: string; params: URLSearchParams } {
  const params = new URLSearchParams();
  if (body.operation === "health") return { path: "/calendar/today", params };

  const symbol = requireSymbol(body.symbol);
  params.set("symbol", symbol);

  switch (body.operation) {
    case "stock-eod":
      setDateRange(params, body.startDate, body.endDate);
      return { path: "/stock/history/eod", params };
    case "option-contracts":
      params.set("date", requireDate(body.date, "date"));
      setOptionalInteger(params, "max_dte", body.maxDte, 0, 3650);
      return { path: "/option/list/contracts/quote", params };
    case "option-eod":
      setOptionContractParams(params, body);
      setDateRange(params, body.startDate, body.endDate);
      return { path: "/option/history/eod", params };
    case "option-quotes":
      setOptionContractParams(params, body);
      setDateRange(params, body.startDate, body.endDate);
      params.set("interval", body.interval || "1m");
      setOptionalInteger(params, "max_dte", body.maxDte, 0, 3650);
      setOptionalInteger(params, "strike_range", body.strikeRange, 0, 1000);
      return { path: "/option/history/quote", params };
    case "option-eod-greeks":
      setOptionContractParams(params, body);
      setDateRange(params, body.startDate, body.endDate);
      return { path: "/option/history/greeks/eod", params };
    default:
      throw new RequestError(`Operazione non consentita: ${String(body.operation)}`);
  }
}

function setOptionContractParams(params: URLSearchParams, body: RequestBody): void {
  const expiration = body.expiration === "*" ? "*" : requireDate(body.expiration, "expiration");
  params.set("expiration", expiration);
  params.set("strike", body.strike === "*" || body.strike == null ? "*" : requirePositiveNumber(body.strike, "strike").toString());
  params.set("right", body.right || "both");
}

function setDateRange(params: URLSearchParams, startDate?: string, endDate?: string): void {
  const start = requireDate(startDate, "startDate");
  const end = requireDate(endDate, "endDate");
  if (normalizeDate(start) > normalizeDate(end)) throw new RequestError("startDate deve precedere endDate");
  params.set("start_date", start);
  params.set("end_date", end);
}

function requireSymbol(value?: string): string {
  const symbol = value?.trim().toUpperCase() || "";
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new RequestError("symbol non valido");
  return symbol;
}

function requireDate(value: string | undefined, field: string): string {
  const date = value?.trim() || "";
  if (!/^\d{8}$/.test(date) && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RequestError(`${field} non valida`);
  return date;
}

function normalizeDate(value: string): string {
  return value.replaceAll("-", "");
}

function requirePositiveNumber(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RequestError(`${field} non valido`);
  return value;
}

function setOptionalInteger(
  params: URLSearchParams,
  key: string,
  value: number | undefined,
  min: number,
  max: number,
): void {
  if (value == null) return;
  if (!Number.isInteger(value) || value < min || value > max) throw new RequestError(`${key} non valido`);
  params.set(key, value.toString());
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number, code: string): Response {
  return jsonResponse({ error: message, code }, status);
}
