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

// Simple in-memory rate limiting (per email and per IP)
// In production, consider using Redis or database-backed rate limiting
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS_PER_WINDOW = 3; // Max 3 requests per email per hour

// Allowed origins whitelist
const ALLOWED_ORIGINS = [
  "https://optionmonitor.lovable.app",
  "https://id-preview--74d3b9d7-602b-4421-9524-4fb4f90db9e9.lovable.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(key);
  
  if (!record || now > record.resetTime) {
    // Reset or create new record
    rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  
  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }
  
  record.count++;
  return false;
}

function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 255;
}

function validateOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return ALLOWED_ORIGINS.some(allowed => {
      const allowedUrl = new URL(allowed);
      return url.origin === allowedUrl.origin;
    });
  } catch {
    return false;
  }
}

// Generic success response - NEVER reveal if email exists or not
const genericSuccessResponse = () => new Response(
  JSON.stringify({ success: true, message: "If an account with that email exists, a reset link has been sent." }),
  { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
);

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, origin }: ResetLinkRequest = await req.json();

    // Validate required fields
    if (!email || !origin) {
      // Return generic response to prevent information leakage
      console.log("Missing required fields");
      return genericSuccessResponse();
    }

    // Validate email format
    const trimmedEmail = email.trim().toLowerCase();
    if (!validateEmail(trimmedEmail)) {
      console.log("Invalid email format:", trimmedEmail.substring(0, 3) + "***");
      return genericSuccessResponse();
    }

    // Validate origin against whitelist to prevent open redirect
    if (!validateOrigin(origin)) {
      console.error("Invalid origin attempted:", origin);
      return genericSuccessResponse();
    }

    // Rate limiting by email
    const emailKey = `email:${trimmedEmail}`;
    if (isRateLimited(emailKey)) {
      console.log("Rate limited for email:", trimmedEmail.substring(0, 3) + "***");
      // Still return success to prevent email enumeration
      return genericSuccessResponse();
    }

    // Get client IP for additional rate limiting (if available)
    const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
                     req.headers.get("x-real-ip") || 
                     "unknown";
    
    if (clientIP !== "unknown") {
      const ipKey = `ip:${clientIP}`;
      if (isRateLimited(ipKey)) {
        console.log("Rate limited for IP:", clientIP);
        return genericSuccessResponse();
      }
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
    // Note: This will fail silently if email doesn't exist (which is what we want)
    const { data, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: trimmedEmail,
    });

    if (linkError) {
      // Log error but return success to prevent email enumeration
      console.error("Error generating recovery link (may be invalid email):", linkError.message);
      return genericSuccessResponse();
    }

    if (!data?.properties?.hashed_token) {
      console.error("No hashed_token in response - email may not exist");
      return genericSuccessResponse();
    }

    // Build reset URL with token_hash as query parameter (survives redirects!)
    const tokenHash = data.properties.hashed_token;
    const resetUrl = `${origin}/reset-password?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;

    console.log("Generated reset URL for:", trimmedEmail.substring(0, 3) + "***");

    // Send email using Resend
    const emailResponse = await resend.emails.send({
      from: "Portfolio Monitor <noreply@resend.dev>",
      to: [trimmedEmail],
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

    console.log("Email sent successfully");

    // Always return generic success
    return genericSuccessResponse();
  } catch (error: any) {
    console.error("Error in generate-reset-link function:", error);
    // Return generic success even on error to prevent information leakage
    return genericSuccessResponse();
  }
});
