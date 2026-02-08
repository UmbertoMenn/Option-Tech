import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface AlertPayload {
  alert_id: string;
  user_id: string;
  ticker: string;
  message: string;
  severity: string;
  alert_type: string;
  portfolio_id?: string;
  strategy_type?: string;
  strike_price?: number;
  underlying_price?: number;
  threshold_value?: number; // For OOB alerts, this contains the breakeven
  option_type?: string;
  option_expiry?: string;
}

interface Profile {
  email: string;
  full_name: string | null;
  notify_email: boolean;
  notify_telegram: boolean;
  telegram_chat_id: string | null;
  user_id: string;
}

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");

// Determine alert type label in Italian
function getAlertTypeLabel(alertType: string): string {
  if (alertType.startsWith('distance_')) return 'Avviso di Distanza';
  if (alertType.startsWith('price_alert_')) return 'Avviso di Prezzo';
  return 'Avviso di Stato';
}

// Get severity emoji
function getSeverityEmoji(severity: string): string {
  if (severity === 'critical') return '🔴';
  if (severity === 'warning') return '🟡';
  return '🔵';
}

// Get severity label in Italian
function getSeverityLabel(severity: string): string {
  if (severity === 'critical') return 'Critical';
  if (severity === 'warning') return 'Warning';
  return 'Info';
}

// Format option display: "CALL 280 LUG/26" or "PUT 220 MAG/26"
function formatOptionDisplay(
  alertType: string, 
  optionType?: string,
  strikePrice?: number, 
  optionExpiry?: string,
  breakeven?: number
): { label: string; value: string } | null {
  // For OOB alerts, show breakeven instead of option
  if (alertType === 'action_strategy_oob') {
    if (breakeven) {
      return { label: 'Breakeven', value: `$${breakeven.toFixed(2)}` };
    }
    return null;
  }
  
  if (!strikePrice) return null;
  
  // Determine option type from alert_type if not provided
  let type = optionType?.toUpperCase();
  if (!type) {
    if (alertType.includes('_call') || alertType === 'action_covered_call_itm') {
      type = 'CALL';
    } else if (alertType.includes('_put') || alertType === 'action_naked_put_itm') {
      type = 'PUT';
    }
  }
  
  // Format expiry (e.g., "LUG/26")
  let expiryStr = '';
  if (optionExpiry) {
    const date = new Date(optionExpiry);
    const months = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 
                   'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
    const month = months[date.getMonth()];
    const year = date.getFullYear().toString().slice(-2);
    expiryStr = ` ${month}/${year}`;
  }
  
  // Format strike (no decimals if whole number)
  const strikeStr = Math.floor(strikePrice) === strikePrice 
    ? strikePrice.toString() 
    : strikePrice.toFixed(2);
  
  return { 
    label: 'Opzione', 
    value: `${type} ${strikeStr}${expiryStr}` 
  };
}

async function sendEmail(
  email: string,
  alertData: AlertPayload,
  isAdmin: boolean = false,
  userName?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const severityEmoji = getSeverityEmoji(alertData.severity);
    const severityLabel = getSeverityLabel(alertData.severity);
    const severityColor = alertData.severity === "critical" ? "#dc2626" : 
                          alertData.severity === "warning" ? "#f59e0b" : "#3b82f6";
    
    const adminPrefix = isAdmin ? "[ADMIN] " : "";
    const alertTypeLabel = getAlertTypeLabel(alertData.alert_type);
    const strategyName = alertData.strategy_type || 'Altre Strategie';
    const optionInfo = formatOptionDisplay(
      alertData.alert_type,
      alertData.option_type,
      alertData.strike_price, 
      alertData.option_expiry,
      alertData.threshold_value
    );
    const priceLabel = alertData.underlying_price ? 
      `<strong>Prezzo ${alertData.ticker}</strong>: $${alertData.underlying_price.toFixed(2)}` : '';
    const priceLabel = alertData.underlying_price ? 
      `<strong>Prezzo ${alertData.ticker}</strong>: $${alertData.underlying_price.toFixed(2)}` : '';
    
    await resend.emails.send({
      from: "Portfolio Alerts <noreply@resend.dev>",
      to: [email],
      subject: `${adminPrefix}${severityEmoji} Avviso Portfolio: ${alertData.ticker}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: ${severityColor}; color: white; padding: 16px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0;">🚨 ${adminPrefix}Avviso Portafoglio</h2>
            <p style="margin: 8px 0 0 0; font-size: 14px;">${severityEmoji} ${severityLabel}</p>
          </div>
          <div style="padding: 20px; background: #f9fafb; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none;">
            <table style="width: 100%; border-collapse: collapse;">
              ${isAdmin && userName ? `
              <tr>
                <td style="padding: 8px 0; color: #6b7280; width: 120px;">Utente:</td>
                <td style="padding: 8px 0;"><strong>${userName}</strong></td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 8px 0; color: #6b7280; width: 120px;">Ticker:</td>
                <td style="padding: 8px 0;"><strong>${alertData.ticker}</strong></td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Strategia:</td>
                <td style="padding: 8px 0;">${strategyName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Messaggio:</td>
                <td style="padding: 8px 0;">${alertData.message}</td>
              </tr>
              ${optionInfo ? `
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">📋 ${optionInfo.label}:</td>
                <td style="padding: 8px 0;">${optionInfo.value}</td>
              </tr>
              ` : ''}
            </table>
            ${priceLabel ? `
            <div style="margin-top: 16px; padding: 12px; background: #e5e7eb; border-radius: 4px;">
              ${priceLabel}
            </div>
            ` : ''}
            <p style="font-size: 12px; color: #9ca3af; margin-top: 16px;">
              ${new Date().toLocaleString('it-IT')}
            </p>
          </div>
        </div>
      `,
    });
    
    return { success: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Email send error:", errorMessage);
    return { success: false, error: errorMessage };
  }
}

async function sendTelegram(
  chatId: string,
  alertData: AlertPayload,
  isAdmin: boolean = false,
  userName?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const severityEmoji = getSeverityEmoji(alertData.severity);
    const severityLabel = getSeverityLabel(alertData.severity);
    const adminPrefix = isAdmin ? "*[ADMIN]* " : "";
    const alertTypeLabel = getAlertTypeLabel(alertData.alert_type);
    const strategyName = alertData.strategy_type || 'Altre Strategie';
    const optionInfo = formatOptionDisplay(
      alertData.alert_type,
      alertData.option_type,
      alertData.strike_price, 
      alertData.option_expiry,
      alertData.threshold_value
    );
    const priceLabel = alertData.underlying_price ? 
      `*Prezzo ${alertData.ticker}*: $${alertData.underlying_price.toFixed(2)}` : '';
    const priceLabel = alertData.underlying_price ? 
      `*Prezzo ${alertData.ticker}*: $${alertData.underlying_price.toFixed(2)}` : '';
    
    let text = `🚨 ${adminPrefix}*Avviso Portafoglio*
${severityEmoji} *${severityLabel}*
${isAdmin && userName ? `\n👤 *Utente:* ${userName}` : ''}

📈 *Ticker:* ${alertData.ticker}
📊 *Strategia:* ${strategyName}
📝 *Messaggio:* ${alertData.message}`;

    if (optionInfo) {
      text += `\n📋 *${optionInfo.label}:* ${optionInfo.value}`;
    }
    
    if (priceLabel) {
      text += `\n\n${priceLabel}`;
    }

    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: "Markdown",
        }),
      }
    );
    
    const result = await response.json();
    
    if (!result.ok) {
      throw new Error(result.description || "Telegram API error");
    }
    
    return { success: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Telegram send error:", errorMessage);
    return { success: false, error: errorMessage };
  }
}

async function logNotification(
  supabase: ReturnType<typeof createClient>,
  alertId: string,
  userId: string,
  channel: "email" | "telegram",
  status: "sent" | "failed",
  errorMessage?: string
) {
  await supabase.from("notification_logs").insert({
    alert_id: alertId,
    user_id: userId,
    channel,
    status,
    error_message: errorMessage,
  });
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const alertData: AlertPayload = await req.json();
    console.log("Received alert:", alertData);
    
    // Fetch additional alert details from database if missing
    if (!alertData.strategy_type || !alertData.strike_price || !alertData.underlying_price || !alertData.threshold_value || !alertData.option_type || !alertData.option_expiry) {
      const { data: alertDetails } = await supabase
        .from('alerts')
        .select('strategy_type, strike_price, underlying_price, threshold_value, option_type, option_expiry')
        .eq('id', alertData.alert_id)
        .single();
      
      if (alertDetails) {
        alertData.strategy_type = alertData.strategy_type || alertDetails.strategy_type;
        alertData.strike_price = alertData.strike_price || alertDetails.strike_price;
        alertData.underlying_price = alertData.underlying_price || alertDetails.underlying_price;
        alertData.threshold_value = alertData.threshold_value || alertDetails.threshold_value;
        alertData.option_type = alertData.option_type || alertDetails.option_type;
        alertData.option_expiry = alertData.option_expiry || alertDetails.option_expiry;
      }
    }

    // 1. Get user profile
    const { data: userProfile, error: profileError } = await supabase
      .from("profiles")
      .select("email, full_name, notify_email, notify_telegram, telegram_chat_id, user_id")
      .eq("user_id", alertData.user_id)
      .single();

    if (profileError || !userProfile) {
      console.error("Profile fetch error:", profileError);
      return new Response(
        JSON.stringify({ error: "User profile not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: { email?: { success: boolean; error?: string }; telegram?: { success: boolean; error?: string } } = {};

    // 2. Send email if enabled
    if (userProfile.notify_email && userProfile.email) {
      results.email = await sendEmail(userProfile.email, alertData);
      await logNotification(
        supabase,
        alertData.alert_id,
        alertData.user_id,
        "email",
        results.email.success ? "sent" : "failed",
        results.email.error
      );
    }

    // 3. Send telegram if enabled
    if (userProfile.notify_telegram && userProfile.telegram_chat_id) {
      results.telegram = await sendTelegram(userProfile.telegram_chat_id, alertData);
      await logNotification(
        supabase,
        alertData.alert_id,
        alertData.user_id,
        "telegram",
        results.telegram.success ? "sent" : "failed",
        results.telegram.error
      );
    }

    // 4. Get admins and notify them too
    const { data: adminRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    if (adminRoles && adminRoles.length > 0) {
      const adminUserIds = adminRoles.map((r) => r.user_id);
      
      const { data: adminProfiles } = await supabase
        .from("profiles")
        .select("email, notify_email, notify_telegram, telegram_chat_id, user_id")
        .in("user_id", adminUserIds)
        .neq("user_id", alertData.user_id); // Don't double-notify if user is admin

      if (adminProfiles) {
        for (const admin of adminProfiles) {
          if (admin.notify_email && admin.email) {
            const emailResult = await sendEmail(admin.email, alertData, true, userProfile.full_name || userProfile.email);
            await logNotification(
              supabase,
              alertData.alert_id,
              admin.user_id,
              "email",
              emailResult.success ? "sent" : "failed",
              emailResult.error
            );
          }
          if (admin.notify_telegram && admin.telegram_chat_id) {
            const telegramResult = await sendTelegram(admin.telegram_chat_id, alertData, true, userProfile.full_name || userProfile.email);
            await logNotification(
              supabase,
              alertData.alert_id,
              admin.user_id,
              "telegram",
              telegramResult.success ? "sent" : "failed",
              telegramResult.error
            );
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
