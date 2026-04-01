import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Simple in-memory rate limiting
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS_PER_WINDOW = 3;

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(key);
  
  if (!record || now > record.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  
  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }
  
  record.count++;
  return false;
}

// Generic success response - NEVER reveal if username exists or not
const genericSuccessResponse = () => new Response(
  JSON.stringify({ success: true }),
  { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
);

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { username }: { username?: string } = await req.json();

    if (!username || !username.trim()) {
      return genericSuccessResponse();
    }

    const trimmedUsername = username.trim().toLowerCase();

    // Rate limiting by username
    if (isRateLimited(`username:${trimmedUsername}`)) {
      return genericSuccessResponse();
    }

    // Rate limiting by IP
    const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
                     req.headers.get("x-real-ip") || "unknown";
    if (clientIP !== "unknown" && isRateLimited(`ip:${clientIP}`)) {
      return genericSuccessResponse();
    }

    // Create Supabase admin client
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Find admin profiles with admin_contact_email configured
    const { data: adminRoles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    if (!adminRoles || adminRoles.length === 0) {
      console.log("No admin users found");
      return genericSuccessResponse();
    }

    const adminUserIds = adminRoles.map((r: any) => r.user_id);

    const { data: adminProfiles } = await supabaseAdmin
      .from("profiles")
      .select("admin_contact_email, full_name")
      .in("user_id", adminUserIds)
      .not("admin_contact_email", "is", null);

    if (!adminProfiles || adminProfiles.length === 0) {
      console.log("No admins with contact email configured");
      return genericSuccessResponse();
    }

    // Send email to each admin with contact email
    for (const admin of adminProfiles) {
      if (!admin.admin_contact_email) continue;

      try {
        await resend.emails.send({
          from: "Portfolio Monitor <noreply@resend.dev>",
          to: [admin.admin_contact_email],
          subject: `🔑 Richiesta Reset Password — ${trimmedUsername}`,
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
                    <span style="font-size: 28px;">🔑</span>
                  </div>
                  <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #ffffff;">Richiesta Reset Password</h1>
                </div>
                
                <p style="color: #a1a1aa; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
                  L'utente <strong style="color: #ffffff;">${trimmedUsername}</strong> ha richiesto il reset della password.
                </p>
                
                <p style="color: #a1a1aa; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
                  Accedi al pannello admin per reimpostare la password dell'utente.
                </p>
                
                <hr style="border: none; border-top: 1px solid #2a2a2a; margin: 32px 0;">
                
                <p style="color: #52525b; font-size: 12px; margin: 0; text-align: center;">
                  Option Tech — ${new Date().toLocaleString('it-IT')}
                </p>
              </div>
            </body>
            </html>
          `,
        });
        console.log(`Reset request email sent to admin: ${admin.full_name}`);
      } catch (emailError) {
        console.error("Error sending reset notification to admin:", emailError);
      }
    }

    return genericSuccessResponse();
  } catch (error: any) {
    console.error("Error in generate-reset-link function:", error);
    return genericSuccessResponse();
  }
});
