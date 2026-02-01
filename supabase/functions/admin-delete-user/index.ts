import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Create admin client with service role key
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // 1. Verify caller's JWT token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Token di autenticazione mancante" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !caller) {
      console.error("Auth error:", authError);
      return new Response(
        JSON.stringify({ error: "Token non valido o scaduto" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Verify caller has admin role
    const { data: adminRole, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .single();

    if (roleError || !adminRole) {
      console.log(`User ${caller.id} attempted admin action without privileges`);
      return new Response(
        JSON.stringify({ error: "Richiede privilegi admin" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Parse request body
    const { userId } = await req.json();

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "userId è obbligatorio" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prevent self-deletion
    if (userId === caller.id) {
      return new Response(
        JSON.stringify({ error: "Non puoi eliminare te stesso" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Get user's portfolios first (needed for cascading deletes)
    const { data: portfolios } = await supabaseAdmin
      .from("portfolios")
      .select("id")
      .eq("user_id", userId);

    const portfolioIds = portfolios?.map(p => p.id) || [];

    console.log(`Deleting user ${userId} with ${portfolioIds.length} portfolios`);

    // 5. Delete data in correct order (respecting foreign keys)
    if (portfolioIds.length > 0) {
      // Delete positions
      const { error: posError } = await supabaseAdmin
        .from("positions")
        .delete()
        .in("portfolio_id", portfolioIds);
      if (posError) console.error("Error deleting positions:", posError);

      // Delete deposits
      const { error: depError } = await supabaseAdmin
        .from("deposits")
        .delete()
        .in("portfolio_id", portfolioIds);
      if (depError) console.error("Error deleting deposits:", depError);

      // Delete historical_data
      const { error: histError } = await supabaseAdmin
        .from("historical_data")
        .delete()
        .in("portfolio_id", portfolioIds);
      if (histError) console.error("Error deleting historical_data:", histError);

      // Delete derivative_overrides
      const { error: derError } = await supabaseAdmin
        .from("derivative_overrides")
        .delete()
        .in("portfolio_id", portfolioIds);
      if (derError) console.error("Error deleting derivative_overrides:", derError);

      // Delete portfolios
      const { error: portError } = await supabaseAdmin
        .from("portfolios")
        .delete()
        .eq("user_id", userId);
      if (portError) console.error("Error deleting portfolios:", portError);
    }

    // Delete user_roles
    const { error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", userId);
    if (rolesError) console.error("Error deleting user_roles:", rolesError);

    // Delete profile
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .delete()
      .eq("user_id", userId);
    if (profileError) console.error("Error deleting profile:", profileError);

    // 6. Finally delete from auth.users
    const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (deleteUserError) {
      console.error("Error deleting auth user:", deleteUserError);
      return new Response(
        JSON.stringify({ error: `Errore eliminazione utente: ${deleteUserError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Successfully deleted user ${userId} by admin ${caller.id}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Utente eliminato con successo",
        deletedPortfolios: portfolioIds.length 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Unexpected error:", error);
    const errorMessage = error instanceof Error ? error.message : "Errore interno del server";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
