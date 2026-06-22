// Shared helper to authenticate internal/cron edge-function calls.
// The shared secret is stored in Supabase Vault as 'cron_secret' and is
// retrieved server-side (cached for the lifetime of the edge function instance).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

let CACHED_CRON_SECRET: string | null = null;

export async function getCronSecret(): Promise<string | null> {
  if (CACHED_CRON_SECRET) return CACHED_CRON_SECRET;

  // Allow an env override (useful for local dev) but prefer the vault value.
  const envValue = Deno.env.get("CRON_SECRET");
  if (envValue) {
    CACHED_CRON_SECRET = envValue;
    return envValue;
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await supabase
      .schema("vault")
      .from("decrypted_secrets")
      .select("decrypted_secret")
      .eq("name", "cron_secret")
      .maybeSingle();
    if (!error && data?.decrypted_secret) {
      CACHED_CRON_SECRET = data.decrypted_secret as string;
      return CACHED_CRON_SECRET;
    }
  } catch (e) {
    console.warn("getCronSecret: vault lookup failed", e);
  }
  return null;
}

/**
 * Returns true if the incoming request carries a valid X-Cron-Secret header.
 */
export async function isCronAuthorized(req: Request): Promise<boolean> {
  const provided = req.headers.get("x-cron-secret");
  if (!provided) return false;
  const expected = await getCronSecret();
  return !!expected && provided === expected;
}

/**
 * Validates an `Authorization: Bearer <jwt>` header and returns the user id, or null.
 */
export async function getAuthenticatedUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data, error } = await sb.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (error || !data?.claims?.sub) return null;
    return data.claims.sub as string;
  } catch {
    return null;
  }
}

export async function isAdminUser(userId: string): Promise<boolean> {
  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}
