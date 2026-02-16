import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");

// ============ DST GUARD: exactly 10:00 Italian time ============

function getCETOffset(now: Date): number {
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();

  if (month >= 3 && month <= 8) return 2; // Apr-Sep → CEST

  if (month === 2) {
    // March: last Sunday
    const lastDay = new Date(Date.UTC(year, 3, 0));
    const lastSunday = lastDay.getUTCDate() - lastDay.getUTCDay();
    const dstStart = new Date(Date.UTC(year, 2, lastSunday, 1)); // 1:00 UTC
    return now >= dstStart ? 2 : 1;
  }

  if (month === 9) {
    // October: last Sunday
    const lastDay = new Date(Date.UTC(year, 10, 0));
    const lastSunday = lastDay.getUTCDate() - lastDay.getUTCDay();
    const dstEnd = new Date(Date.UTC(year, 9, lastSunday, 1)); // 1:00 UTC
    return now >= dstEnd ? 1 : 2;
  }

  return 1; // Nov-Feb → CET
}

function isItalian10AM(): boolean {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  const offset = getCETOffset(now);
  const italianHour = now.getUTCHours() + offset;
  return italianHour === 10 && now.getUTCMinutes() < 10; // allow small window
}

// ============ NORMALIZATION (mirrors frontend) ============

function normalizeForMatching(str: string): string {
  return str
    .toUpperCase()
    .replace(/^AZ\.\s*/i, '')
    .replace(/\s*\(.*?\)\s*$/, '')  // remove trailing parentheses
    .replace(/\s+(INC|CORP|CORPORATION|LTD|PLC|AG|SA|SPA|ADR|CLASS\s*[A-Z]?)\.?\s*$/gi, '')
    .replace(/[.,]/g, '')
    .trim();
}

function resolveStockTicker(
  description: string,
  mappings: { underlying: string; ticker: string }[],
): string | null {
  const normalized = normalizeForMatching(description);
  // Direct match on normalized underlying
  for (const m of mappings) {
    if (normalizeForMatching(m.underlying) === normalized) {
      return m.ticker.toUpperCase();
    }
  }
  // Substring match: check if normalized description contains the mapping name or vice versa
  for (const m of mappings) {
    const normMapping = normalizeForMatching(m.underlying);
    if (normalized.includes(normMapping) || normMapping.includes(normalized)) {
      return m.ticker.toUpperCase();
    }
  }
  return null;
}

// ============ INTERFACES ============

interface StrategyCache {
  portfolio_id: string;
  strategy_key: string;
  strategy_type: string;
  underlying: string;
  ticker: string | null;
  position_ids: string[];
  sold_put_strike: number | null;
  sold_call_strike: number | null;
  bought_put_strike: number | null;
  bought_call_strike: number | null;
  is_range_strategy: boolean;
  sold_call_expiry: string | null;
  sold_put_expiry: string | null;
}

interface BriefingSection {
  title: string;
  emoji: string;
  items: string[];
}

// ============ MONITORING LOGIC ============

function buildBriefingSections(
  strategies: StrategyCache[],
  underlyingPrices: Record<string, number>,
  positions: any[],
  underlyingMappings: { underlying: string; ticker: string }[],
): BriefingSection[] {
  const sections: BriefingSection[] = [];

  // 1. Naked Call detection — resolve stock descriptions to tickers via underlying_mappings
  const sharesPerTicker = new Map<string, number>(); // ticker -> total shares owned

  for (const pos of positions) {
    if (pos.asset_type !== 'stock' && pos.asset_type !== 'equity') continue;
    // Try position ticker first, then resolve from description
    let ticker = pos.ticker ? pos.ticker.toUpperCase() : null;
    if (!ticker && pos.description) {
      ticker = resolveStockTicker(pos.description, underlyingMappings);
    }
    if (!ticker) continue;
    sharesPerTicker.set(ticker, (sharesPerTicker.get(ticker) || 0) + pos.quantity);
  }

  // Count net sold calls per ticker from strategy_cache
  const netSoldCallsPerTicker = new Map<string, number>();

  for (const s of strategies) {
    const ticker = (s.ticker || '').toUpperCase();
    if (!ticker) continue;

    if (s.strategy_type === 'Covered Call') {
      netSoldCallsPerTicker.set(ticker, (netSoldCallsPerTicker.get(ticker) || 0) + 1);
    } else if (s.strategy_type === 'Iron Condor' || s.strategy_type === 'Double Diagonal' || s.strategy_type === 'Alternative Double Diagonal') {
      // sold call + bought call = net 0
    } else if (s.strategy_type === 'LEAP Call') {
      // bought call, no sold call
    } else {
      // Other strategies: count sold minus bought
      if (s.sold_call_strike) netSoldCallsPerTicker.set(ticker, (netSoldCallsPerTicker.get(ticker) || 0) + 1);
      if (s.bought_call_strike) netSoldCallsPerTicker.set(ticker, (netSoldCallsPerTicker.get(ticker) || 0) - 1);
    }
  }

  const nakedCallItems: string[] = [];
  for (const [ticker, netSold] of netSoldCallsPerTicker) {
    if (netSold <= 0) continue;
    const shares = sharesPerTicker.get(ticker) || 0;
    const coveredContracts = Math.floor(shares / 100);
    const uncovered = netSold - coveredContracts;
    if (uncovered > 0) {
      nakedCallItems.push(`${ticker} (${uncovered} contratt${uncovered === 1 ? 'o' : 'i'} scopert${uncovered === 1 ? 'o' : 'i'})`);
    }
  }
  if (nakedCallItems.length > 0) {
    sections.push({ title: 'Naked Call', emoji: '🔴', items: nakedCallItems });
  }

  // 2. Covered Call ITM
  const ccITMItems: string[] = [];
  for (const s of strategies) {
    if (s.strategy_type !== 'Covered Call') continue;
    const price = s.ticker ? underlyingPrices[s.ticker] : 0;
    const strike = s.sold_call_strike || 0;
    if (price && strike > 0 && price > strike) {
      ccITMItems.push(`${s.ticker || s.underlying} strike ${strike}`);
    }
  }
  if (ccITMItems.length > 0) {
    sections.push({ title: 'Covered Call ITM', emoji: '🔴', items: ccITMItems });
  }

  // 3. Naked Put ITM
  const npITMItems: string[] = [];
  for (const s of strategies) {
    if (s.strategy_type !== 'Naked Put') continue;
    const price = s.ticker ? underlyingPrices[s.ticker] : 0;
    const strike = s.sold_put_strike || 0;
    if (price && strike > 0 && price < strike) {
      npITMItems.push(`${s.ticker || s.underlying} strike ${strike}`);
    }
  }
  if (npITMItems.length > 0) {
    sections.push({ title: 'Naked Put ITM', emoji: '🔴', items: npITMItems });
  }

  // 4. Iron Condor OOR
  const icOORItems: string[] = [];
  for (const s of strategies) {
    if (s.strategy_type !== 'Iron Condor') continue;
    const price = s.ticker ? underlyingPrices[s.ticker] : 0;
    if (!price) continue;
    const putStrike = s.sold_put_strike || 0;
    const callStrike = s.sold_call_strike || 0;
    if (putStrike > 0 && callStrike > 0 && (price < putStrike || price > callStrike)) {
      icOORItems.push(s.ticker || s.underlying);
    }
  }
  if (icOORItems.length > 0) {
    sections.push({ title: 'Iron Condor OOR', emoji: '🔴', items: icOORItems });
  }

  // 5. Double Diagonal OOR
  const ddOORItems: string[] = [];
  for (const s of strategies) {
    if (s.strategy_type !== 'Double Diagonal' && s.strategy_type !== 'Alternative Double Diagonal') continue;
    const price = s.ticker ? underlyingPrices[s.ticker] : 0;
    if (!price) continue;
    const putStrike = s.sold_put_strike || 0;
    const callStrike = s.sold_call_strike || 0;
    if (putStrike > 0 && callStrike > 0 && (price < putStrike || price > callStrike)) {
      ddOORItems.push(s.ticker || s.underlying);
    }
  }
  if (ddOORItems.length > 0) {
    sections.push({ title: 'Double Diagonal OOR', emoji: '🔴', items: ddOORItems });
  }

  // 6. Other Strategies OOR
  const rangeStrategies = [
    'Short Strangle', 'Bull Put Spread', 'Bear Put Spread',
    'Bull Call Spread', 'Bear Call Spread',
    'Diagonal Call Spread', 'Diagonal Put Spread',
  ];
  const otherOORItems: string[] = [];
  for (const s of strategies) {
    if (['Covered Call', 'Naked Put', 'Iron Condor', 'Double Diagonal', 'Alternative Double Diagonal', 'LEAP Call'].includes(s.strategy_type)) continue;
    const price = s.ticker ? underlyingPrices[s.ticker] : 0;
    if (!price) continue;
    const isRange = rangeStrategies.some(r => s.strategy_type.includes(r)) || s.is_range_strategy;
    if (isRange) {
      let isOOR = false;
      if (s.strategy_type.includes('Strangle')) {
        if (s.sold_put_strike && s.sold_call_strike) isOOR = price < s.sold_put_strike || price > s.sold_call_strike;
      } else if (s.strategy_type.includes('Put')) {
        if (s.sold_put_strike) isOOR = price < s.sold_put_strike;
      } else if (s.strategy_type.includes('Call')) {
        if (s.sold_call_strike) isOOR = price > s.sold_call_strike;
      } else if (s.sold_put_strike && s.sold_call_strike) {
        isOOR = price < s.sold_put_strike || price > s.sold_call_strike;
      }
      if (isOOR) otherOORItems.push(`${s.ticker || s.underlying} - ${s.strategy_type} (OOR)`);
    }
  }
  if (otherOORItems.length > 0) {
    sections.push({ title: 'Altre Strategie OOR', emoji: '🟡', items: otherOORItems });
  }

  // 7. Leap Call in Gain
  const leapGainItems: string[] = [];
  for (const s of strategies) {
    if (s.strategy_type !== 'LEAP Call') continue;
    const leapPositions = positions.filter(p => s.position_ids.includes(p.id));
    for (const lp of leapPositions) {
      const avgCost = lp.avg_cost || 0;
      const currentPrice = lp.current_price || 0;
      if (avgCost > 0 && currentPrice > avgCost) {
        const gainPct = ((currentPrice - avgCost) / avgCost * 100).toFixed(0);
        leapGainItems.push(`${s.ticker || s.underlying} strike ${s.bought_call_strike || '?'} (+${gainPct}%)`);
      }
    }
  }
  if (leapGainItems.length > 0) {
    sections.push({ title: 'Leap Call in Gain', emoji: '🟢', items: leapGainItems });
  }

  // 8. Call da rivendere — uses same resolved ticker logic
  const ccByTicker = new Map<string, number>();
  for (const s of strategies) {
    if (s.strategy_type !== 'Covered Call') continue;
    const t = (s.ticker || '').toUpperCase();
    if (t) ccByTicker.set(t, (ccByTicker.get(t) || 0) + 1);
  }

  const callToSellItems: string[] = [];
  for (const [ticker, shares] of sharesPerTicker) {
    const potentialContracts = Math.floor(shares / 100);
    const soldContracts = ccByTicker.get(ticker) || 0;
    const available = potentialContracts - soldContracts;
    if (available >= 1) {
      callToSellItems.push(`${ticker} (${available * 100} azioni disponibili)`);
    }
  }
  if (callToSellItems.length > 0) {
    sections.push({ title: 'Call da rivendere', emoji: '📈', items: callToSellItems });
  }

  return sections;
}

// ============ MESSAGE FORMATTING ============

function formatDateIT(): string {
  const now = new Date();
  const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  return `${now.getUTCDate()} ${months[now.getUTCMonth()]} ${now.getUTCFullYear()}`;
}

function buildTelegramMessage(sections: BriefingSection[], userName?: string): string {
  let msg = `📋 *Briefing Pre-Apertura*\n📅 ${formatDateIT()}\n`;
  if (userName) {
    msg += `👤 *${userName}*\n`;
  }

  for (const section of sections) {
    msg += `\n${section.emoji} *${section.title}*\n`;
    for (const item of section.items) {
      msg += `  ${item}\n`;
    }
  }

  return msg;
}

function buildEmailHTML(sections: BriefingSection[], userName?: string): string {
  let rows = '';
  for (const section of sections) {
    rows += `
      <tr>
        <td style="padding: 12px 0 4px 0; font-weight: bold; font-size: 15px;">
          ${section.emoji} ${section.title}
        </td>
      </tr>`;
    for (const item of section.items) {
      rows += `
      <tr>
        <td style="padding: 2px 0 2px 20px; font-size: 14px; color: #374151;">${item}</td>
      </tr>`;
    }
  }

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1e40af; color: white; padding: 16px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0;">📋 Briefing Pre-Apertura</h2>
        <p style="margin: 4px 0 0 0; font-size: 14px;">📅 ${formatDateIT()}${userName ? ` — ${userName}` : ''}</p>
      </div>
      <div style="padding: 16px; background: #f9fafb; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none;">
        <table style="width: 100%; border-collapse: collapse;">
          ${rows}
        </table>
        <p style="font-size: 12px; color: #9ca3af; margin-top: 16px;">
          Generato automaticamente alle 10:00.
        </p>
      </div>
    </div>
  `;
}

// ============ SEND FUNCTIONS ============

async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
      }
    );
    const result = await response.json();
    if (!result.ok) {
      console.error("Telegram error:", result.description);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Telegram send error:", e);
    return false;
  }
}

async function sendEmail(email: string, subject: string, html: string): Promise<boolean> {
  try {
    await resend.emails.send({
      from: "Portfolio Alerts <noreply@resend.dev>",
      to: [email],
      subject,
      html,
    });
    return true;
  } catch (e) {
    console.error("Email send error:", e);
    return false;
  }
}

// ============ MAIN HANDLER ============

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const force = body?.force === true;

    // Smart guard: only run at exactly 10:00 Italian time
    if (!force && !isItalian10AM()) {
      console.log("Not 10:00 Italian time, skipping briefing");
      return new Response(
        JSON.stringify({ skipped: true, reason: "not_italian_noon" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    console.log("Starting daily briefing...");

    // 1. Get all underlying prices + mappings
    const [{ data: pricesData }, { data: mappingsData }] = await Promise.all([
      supabase.from("underlying_prices").select("ticker, price"),
      supabase.from("underlying_mappings").select("underlying, ticker"),
    ]);
    
    const underlyingPrices: Record<string, number> = {};
    for (const p of pricesData || []) {
      underlyingPrices[p.ticker] = p.price;
    }
    const underlyingMappings = (mappingsData || []) as { underlying: string; ticker: string }[];

    // 2. Get users with notifications enabled
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, email, full_name, notify_email, notify_telegram, telegram_chat_id");

    const notifiableUsers = (profiles || []).filter(
      (p: any) => p.notify_telegram || p.notify_email
    );

    console.log(`Found ${notifiableUsers.length} users with notifications enabled`);

    // 3. Get admin users for oversight
    const { data: adminRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const adminUserIds = new Set((adminRoles || []).map((r: any) => r.user_id));

    // Get admin profiles
    const { data: adminProfiles } = await supabase
      .from("profiles")
      .select("user_id, email, full_name, admin_notify_email, admin_notify_telegram, telegram_chat_id")
      .in("user_id", Array.from(adminUserIds));

    let totalSent = 0;

    // 4. Process each notifiable user
    for (const user of notifiableUsers) {
      // Get user's portfolios
      const { data: portfolios } = await supabase
        .from("portfolios")
        .select("id")
        .eq("user_id", user.user_id);

      if (!portfolios || portfolios.length === 0) continue;

      const portfolioIds = portfolios.map((p: any) => p.id);

      // Get strategy cache for all portfolios
      const { data: strategiesCache } = await supabase
        .from("strategy_cache")
        .select("*")
        .in("portfolio_id", portfolioIds);

      if (!strategiesCache || strategiesCache.length === 0) continue;

      // Get positions for LEAP gain and naked call checks
      const { data: positions } = await supabase
        .from("positions")
        .select("id, portfolio_id, asset_type, description, ticker, underlying, option_type, strike_price, quantity, current_price, avg_cost, expiry_date")
        .in("portfolio_id", portfolioIds);

      // Build briefing
      const sections = buildBriefingSections(
        strategiesCache as StrategyCache[],
        underlyingPrices,
        positions || [],
        underlyingMappings
      );

      if (sections.length === 0) {
        console.log(`No items to monitor for user ${user.email}, skipping`);
        continue;
      }

      const userName = user.full_name || user.email;

      // Send to user
      if (user.notify_telegram && user.telegram_chat_id) {
        const msg = buildTelegramMessage(sections);
        const ok = await sendTelegram(user.telegram_chat_id, msg);
        if (ok) totalSent++;
      }

      if (user.notify_email && user.email) {
        const html = buildEmailHTML(sections);
        const ok = await sendEmail(user.email, `📋 Briefing Pre-Apertura — ${formatDateIT()}`, html);
        if (ok) totalSent++;
      }

      // Send to admins (if not the same user)
      if (adminProfiles) {
        for (const admin of adminProfiles) {
          if (admin.user_id === user.user_id) continue;

          if (admin.admin_notify_telegram && admin.telegram_chat_id) {
            const msg = buildTelegramMessage(sections, userName);
            await sendTelegram(admin.telegram_chat_id, msg);
          }

          if (admin.admin_notify_email && admin.email) {
            const html = buildEmailHTML(sections, userName);
            await sendEmail(admin.email, `📋 Briefing Pre-Apertura — ${userName} — ${formatDateIT()}`, html);
          }
        }
      }
    }

    console.log(`Daily briefing complete. Sent ${totalSent} notifications.`);

    return new Response(
      JSON.stringify({ success: true, sent: totalSent }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Daily briefing error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

