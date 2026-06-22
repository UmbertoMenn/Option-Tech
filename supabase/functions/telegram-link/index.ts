import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function generateCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "LINK-";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.pathname.split("/").pop();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Handle Telegram webhook updates
    if (req.method === "POST" && action === "webhook") {
      // Validate Telegram secret token to confirm origin
      const expectedSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
      const providedSecret = req.headers.get("x-telegram-bot-api-secret-token");
      if (!expectedSecret || providedSecret !== expectedSecret) {
        console.warn("Rejected Telegram webhook: invalid secret token");
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const update = await req.json();
      console.log("Telegram webhook update:", update);


      if (update.message?.text) {
        const chatId = update.message.chat.id.toString();
        const text = update.message.text.trim().toUpperCase();
        const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");

        // Check if it's a link code
        if (text.startsWith("LINK-")) {
          const { data: linkCode, error } = await supabase
            .from("telegram_link_codes")
            .select("*")
            .eq("code", text)
            .is("used_at", null)
            .gt("expires_at", new Date().toISOString())
            .single();

          let responseText: string;

          if (linkCode && !error) {
            // Update the profile with the chat_id
            await supabase
              .from("profiles")
              .update({ telegram_chat_id: chatId })
              .eq("user_id", linkCode.user_id);

            // Mark the code as used
            await supabase
              .from("telegram_link_codes")
              .update({ used_at: new Date().toISOString() })
              .eq("id", linkCode.id);

            responseText = "✅ Account collegato con successo! Riceverai le notifiche degli avvisi del tuo portfolio su Telegram.";
          } else {
            responseText = "❌ Codice non valido o scaduto. Genera un nuovo codice dall'applicazione.";
          }

          // Send response to user
          await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text: responseText,
              }),
            }
          );
        } else if (text === "/START") {
          await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text: "👋 Benvenuto! Per collegare il tuo account, vai nelle impostazioni dell'app e clicca su 'Collega Telegram'. Ti verrà fornito un codice da inviare qui.",
              }),
            }
          );
        }
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle generate action (from frontend)
    if (req.method === "POST" && action === "generate") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const token = authHeader.replace("Bearer ", "");
      const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
      
      if (claimsError || !claimsData?.claims) {
        return new Response(
          JSON.stringify({ error: "Invalid token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const userId = claimsData.claims.sub as string;

      // Invalidate any existing unused codes for this user
      await supabase
        .from("telegram_link_codes")
        .update({ expires_at: new Date().toISOString() })
        .eq("user_id", userId)
        .is("used_at", null);

      // Generate new code with 10 minute expiry
      const code = generateCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      const { error: insertError } = await supabase
        .from("telegram_link_codes")
        .insert({
          user_id: userId,
          code: code,
          expires_at: expiresAt,
        });

      if (insertError) {
        console.error("Insert error:", insertError);
        return new Response(
          JSON.stringify({ error: "Failed to generate code" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ code, expires_at: expiresAt }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle unlink action
    if (req.method === "POST" && action === "unlink") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const token = authHeader.replace("Bearer ", "");
      const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
      
      if (claimsError || !claimsData?.claims) {
        return new Response(
          JSON.stringify({ error: "Invalid token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const userId = claimsData.claims.sub as string;

      await supabase
        .from("profiles")
        .update({ telegram_chat_id: null, notify_telegram: false })
        .eq("user_id", userId);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Handler error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
