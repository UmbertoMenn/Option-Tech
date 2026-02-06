import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ResetLinkRequest {
  email: string;
  origin: string;
}

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, origin }: ResetLinkRequest = await req.json();

    // Validate required fields
    if (!email || !origin) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: email and origin" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Create Supabase admin client
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Generate recovery link using admin API
    const { data, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: email,
    });

    if (linkError) {
      console.error("Error generating recovery link:", linkError);
      return new Response(
        JSON.stringify({ error: "Failed to generate recovery link" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!data?.properties?.hashed_token) {
      console.error("No hashed_token in response:", data);
      return new Response(
        JSON.stringify({ error: "Invalid recovery link data" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Build reset URL with token_hash as query parameter (survives redirects!)
    const tokenHash = data.properties.hashed_token;
    const resetUrl = `${origin}/reset-password?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;

    console.log("Generated reset URL for:", email);

    // Send email using Resend
    const emailResponse = await resend.emails.send({
      from: "Portfolio Monitor <noreply@resend.dev>",
      to: [email],
      subject: "Reset della password",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 40px 20px; background-color: #0a0a0a; color: #ffffff;">
          <div style="max-width: 480px; margin: 0 auto; background-color: #1a1a1a; border-radius: 12px; padding: 40px; border: 1px solid #2a2a2a;">
            <div style="text-align: center; margin-bottom: 32px;">
              <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); border-radius: 16px; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center;">
                <span style="font-size: 28px;">📈</span>
              </div>
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #ffffff;">Reset Password</h1>
            </div>
            
            <p style="color: #a1a1aa; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
              Hai richiesto di reimpostare la password del tuo account Portfolio Monitor. Clicca il pulsante qui sotto per procedere:
            </p>
            
            <div style="text-align: center; margin: 32px 0;">
              <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                Reimposta Password
              </a>
            </div>
            
            <p style="color: #71717a; font-size: 14px; line-height: 1.5; margin: 24px 0 0;">
              Se non hai richiesto questo reset, puoi ignorare questa email. Il link scadrà tra 1 ora.
            </p>
            
            <hr style="border: none; border-top: 1px solid #2a2a2a; margin: 32px 0;">
            
            <p style="color: #52525b; font-size: 12px; margin: 0; text-align: center;">
              Portfolio Monitor
            </p>
          </div>
        </body>
        </html>
      `,
    });

    console.log("Email sent successfully:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, message: "Reset email sent" }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in generate-reset-link function:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
