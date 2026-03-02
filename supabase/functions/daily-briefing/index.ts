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

// ============ DST GUARD: exactly 11:00 Italian time ============

function getCETOffset(now: Date): number {
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();

  if (month >= 3 && month <= 8) return 2; // Apr-Sep → CEST

  if (month === 2) {
    const lastDay = new Date(Date.UTC(year, 3, 0));
    const lastSunday = lastDay.getUTCDate() - lastDay.getUTCDay();
    const dstStart = new Date(Date.UTC(year, 2, lastSunday, 1));
    return now >= dstStart ? 2 : 1;
  }

  if (month === 9) {
    const lastDay = new Date(Date.UTC(year, 10, 0));
    const lastSunday = lastDay.getUTCDate() - lastDay.getUTCDay();
    const dstEnd = new Date(Date.UTC(year, 9, lastSunday, 1));
    return now >= dstEnd ? 1 : 2;
  }

  return 1;
}

function isItalian11AM(): boolean {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  const offset = getCETOffset(now);
  const italianHour = now.getUTCHours() + offset;
  return italianHour === 11 && now.getUTCMinutes() < 10;
}

// ============ EMOJI MAPPING ============

const EMOJI_MAP: Record<string, string> = {
  red: '🔴',
  amber: '🟡',
  orange: '🟠',
  purple: '🟣',
  cyan: '🔵',
  green: '🟢',
};

// ============ INTERFACES ============

interface SnapshotSection {
  title: string;
  emoji: string;
  badge?: string;
  items: string[];
}

interface PortfolioBriefing {
  portfolioName: string;
  sections: SnapshotSection[];
}

interface StrategyRow {
  id: string;
  portfolio_id: string;
  strategy_type: string;
  strategy_key: string;
  underlying: string;
  ticker: string | null;
  sold_call_strike: number | null;
  sold_put_strike: number | null;
  bought_call_strike: number | null;
  bought_put_strike: number | null;
  sold_call_expiry: string | null;
  sold_put_expiry: string | null;
  position_ids: string[];
  is_range_strategy: boolean | null;
}

interface PositionRow {
  id: string;
  portfolio_id: string;
  ticker: string | null;
  description: string;
  asset_type: string;
  quantity: number;
  current_price: number | null;
  avg_cost: number | null;
  market_value: number | null;
  option_type: string | null;
  strike_price: number | null;
  underlying: string | null;
}

// ============ MATCHING FUNCTIONS (replicated from frontend derivativeStrategies.ts) ============

const SPECIAL_ALIASES: Record<string, string[]> = {
  ALPHABET: ['GOOGL', 'GOOG', 'GOOGLE', 'ALPHABET', 'ALPHABET INC', 'ALPHABET CLASS'],
  PDD: ['PDD', 'PINDUODUO', 'PDD HOLDINGS', 'PINDUODUO INC', 'PDD HOLDINGS INC'],
  NETEASE: ['NETEASE', 'NTES', 'NETEASE INC', 'NETEASE INC ADR'],
  ENI: ['ENI', 'ENI SPA', 'ENI STOCK', 'ENI - STOCK'],
  APPLE: ['APPLE', 'AAPL', 'APPLE INC', 'APPLE COMPUTER', 'APPLE COMPUTER INC'],
  JPMORGAN: ['JPMORGAN', 'JP MORGAN', 'J.P. MORGAN', 'JPMORGAN CHASE', 'JP MORGAN CHASE', 'J.P. MORGAN CHASE', 'JPM'],
  AMAZON: ['AMAZON', 'AMZN', 'AMAZON COM', 'AMAZON.COM', 'AMAZON.COM.INC', 'AMAZON COM INC'],
};

function normalizeForMatching(text: string): string {
  return text
    .toUpperCase()
    .replace(/^AZ\./i, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/([A-Z]{3,})\.([A-Z])/g, '$1 $2')
    .replace(/([A-Z])\.([A-Z]{3,})/g, '$1 $2')
    .replace(/([A-Z])\.([A-Z])/g, '$1$2')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\b(INC|CORP|CORPORATION|LTD|LIMITED|CLASS\s*[A-Z]?|CL\s*[A-Z]?|COMMON|STOCK|DEL|OHIO|CA|THE|ADR|SPA|AG|SA|NV|PLC)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCanonicalKey(text: string): string | null {
  const normalized = normalizeForMatching(text);
  for (const [canonical, aliases] of Object.entries(SPECIAL_ALIASES)) {
    for (const alias of aliases) {
      const normalizedAlias = normalizeForMatching(alias);
      if (normalized === normalizedAlias ||
          normalized.includes(normalizedAlias) ||
          normalizedAlias.includes(normalized)) {
        return canonical;
      }
    }
  }
  return null;
}

function getMatchingKey(text: string): string {
  return getCanonicalKey(text) || normalizeForMatching(text);
}

// ============ TICKER RESOLUTION VIA underlying_mappings ============

function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\bINC\b/g, '')
    .replace(/\bCORP\b/g, '')
    .replace(/\bLTD\b/g, '')
    .replace(/\bLLC\b/g, '')
    .replace(/\bPLC\b/g, '')
    .replace(/\bCO\b/g, '')
    .replace(/\bTHE\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveStockTicker(
  description: string,
  mappings: Map<string, string>,       // direct: underlying -> ticker
  normalizedMappings: Map<string, string> // normalized underlying -> ticker
): string | null {
  // Remove AZ. prefix
  const cleaned = description.replace(/^AZ\./i, '').trim();

  // Direct match
  const direct = mappings.get(cleaned);
  if (direct) return direct;

  // Normalized match
  const norm = normalizeName(cleaned);
  const normalized = normalizedMappings.get(norm);
  if (normalized) return normalized;

  return null;
}

// ============ SERVER-SIDE COMPUTATION FROM strategy_cache ============

async function computeSectionsFromCache(
  supabase: any,
  portfolioId: string
): Promise<SnapshotSection[]> {
  // 1. Load strategy_cache for this portfolio
  const { data: strategies } = await supabase
    .from("strategy_cache")
    .select("*")
    .eq("portfolio_id", portfolioId);

  if (!strategies || strategies.length === 0) {
    return [];
  }

  const typedStrategies = strategies as StrategyRow[];

  // 2. Collect all tickers from strategies to fetch prices
  const tickers = new Set<string>();
  for (const s of typedStrategies) {
    if (s.ticker) tickers.add(s.ticker);
    if (s.underlying) tickers.add(s.underlying);
  }

  // 3. Load underlying_prices
  const { data: priceRows } = await supabase
    .from("underlying_prices")
    .select("ticker, price")
    .in("ticker", Array.from(tickers));

  const prices: Record<string, number> = {};
  for (const p of (priceRows || [])) {
    prices[p.ticker] = p.price;
  }

  // 4. Load positions for this portfolio
  const { data: positionRows } = await supabase
    .from("positions")
    .select("id, portfolio_id, ticker, description, asset_type, quantity, current_price, avg_cost, market_value, option_type, strike_price, underlying")
    .eq("portfolio_id", portfolioId);

  const positions = (positionRows || []) as PositionRow[];
  const stockPositions = positions.filter(p => p.asset_type === "stock");

  // 5. Load underlying_mappings for ticker-based matching
  const { data: mappingRows } = await supabase
    .from("underlying_mappings")
    .select("underlying, ticker");

  const directMappings = new Map<string, string>();
  const normalizedMappings = new Map<string, string>();
  for (const m of (mappingRows || [])) {
    directMappings.set(m.underlying, m.ticker);
    const norm = normalizeName(m.underlying);
    if (!normalizedMappings.has(norm)) normalizedMappings.set(norm, m.ticker);
  }

  // Helper to get price for a strategy — prefer resolved mapping ticker over cached ticker
  const getPrice = (s: StrategyRow): number => {
    // First try resolving via underlying_mappings (canonical ticker, e.g. SAP.DE)
    const resolved = resolveStockTicker(s.underlying, directMappings, normalizedMappings);
    if (resolved && prices[resolved]) return prices[resolved];
    // Then try cached ticker
    if (s.ticker && prices[s.ticker]) return prices[s.ticker];
    if (s.underlying && prices[s.underlying]) return prices[s.underlying];
    return 0;
  };

  // Helper to get display ticker
  const displayTicker = (s: StrategyRow): string => {
    return (s.ticker || s.underlying || "N/A").split(" ")[0];
  };

  const sections: SnapshotSection[] = [];

  // ============ 1. Call non coperte ============
  // Replicate frontend logic: for each underlying, sum sold/bought calls from ALL strategies
  const underlyingBalance = new Map<string, {
    owned: number;
    soldCalls: number;
    boughtCalls: number;
    strategies: Set<string>;
  }>();

  // Count stock shares - use ticker-based matching
  for (const stock of stockPositions) {
    const key = resolveStockTicker(stock.description, directMappings, normalizedMappings)
      || getMatchingKey(stock.description);
    if (!underlyingBalance.has(key)) {
      underlyingBalance.set(key, { owned: 0, soldCalls: 0, boughtCalls: 0, strategies: new Set() });
    }
    underlyingBalance.get(key)!.owned += stock.quantity;
  }

  // Count calls from strategies - resolve ticker via mappings for consistency with stock resolution
  for (const s of typedStrategies) {
    // Use the same resolution path as stocks: first try underlying_mappings, then fallback
    const resolvedTicker = resolveStockTicker(s.underlying, directMappings, normalizedMappings);
    const key = resolvedTicker || s.ticker || getMatchingKey(s.underlying);

    if (!underlyingBalance.has(key)) {
      underlyingBalance.set(key, { owned: 0, soldCalls: 0, boughtCalls: 0, strategies: new Set() });
    }
    const bal = underlyingBalance.get(key)!;

    if (s.strategy_type === "Covered Call") {
      // Covered Call: each has 1 sold call per strategy_cache row
      // Count contracts from position_ids (each position = 1+ contracts)
      const posId = s.position_ids?.[0]; // first is the option
      const pos = posId ? positions.find(p => p.id === posId) : null;
      const contracts = pos ? Math.abs(pos.quantity) : 1;
      bal.soldCalls += contracts;
      bal.strategies.add("Covered Call");
    } else if (s.strategy_type === "Iron Condor") {
      // IC has both sold and bought calls (net = 0 for call exposure)
      // But sold call count matters for uncovered check
      // Each IC = 1 contract sold call + 1 bought call
      const posIds = s.position_ids || [];
      // Find sold call position to get contract count
      let contracts = 1;
      for (const pid of posIds) {
        const pos = positions.find(p => p.id === pid);
        if (pos && pos.option_type === "call" && pos.quantity < 0) {
          contracts = Math.abs(pos.quantity);
          break;
        }
      }
      bal.soldCalls += contracts;
      bal.boughtCalls += contracts;
      bal.strategies.add("Iron Condor");
    } else if (s.strategy_type === "Double Diagonal") {
      const posIds = s.position_ids || [];
      let contracts = 1;
      for (const pid of posIds) {
        const pos = positions.find(p => p.id === pid);
        if (pos && pos.option_type === "call" && pos.quantity < 0) {
          contracts = Math.abs(pos.quantity);
          break;
        }
      }
      bal.soldCalls += contracts;
      bal.boughtCalls += contracts;
      bal.strategies.add("Double Diagonal");
    } else if (s.strategy_type === "LEAP Call") {
      const posIds = s.position_ids || [];
      let contracts = 1;
      for (const pid of posIds) {
        const pos = positions.find(p => p.id === pid);
        if (pos && pos.option_type === "call" && pos.quantity > 0) {
          contracts = pos.quantity;
          break;
        }
      }
      bal.boughtCalls += contracts;
      bal.strategies.add("Leap Call");
    } else {
      // Other strategies: check position_ids for any call positions
      const posIds = s.position_ids || [];
      for (const pid of posIds) {
        const pos = positions.find(p => p.id === pid);
        if (pos && pos.option_type === "call") {
          if (pos.quantity < 0) {
            bal.soldCalls += Math.abs(pos.quantity);
          } else {
            bal.boughtCalls += pos.quantity;
          }
        }
      }
      if (s.strategy_type) bal.strategies.add(s.strategy_type);
    }
  }

  const uncoveredCalls: { ticker: string; uncoveredContracts: number }[] = [];
  for (const [key, data] of underlyingBalance) {
    const coveredContracts = Math.floor(data.owned / 100);
    const netSoldCalls = data.soldCalls - data.boughtCalls;
    if (netSoldCalls > coveredContracts) {
      uncoveredCalls.push({
        ticker: key,
        uncoveredContracts: netSoldCalls - coveredContracts,
      });
    }
  }
  if (uncoveredCalls.length > 0) {
    uncoveredCalls.sort((a, b) => b.uncoveredContracts - a.uncoveredContracts);
    sections.push({
      title: "Call non coperte",
      emoji: "red",
      items: uncoveredCalls.map(uc => `${uc.ticker}: ${uc.uncoveredContracts}NC`),
    });
  }

  // ============ 2. Covered Call ITM ============
  const coveredCallsITM: { ticker: string; strike: number; contracts: number }[] = [];
  for (const s of typedStrategies.filter(s => s.strategy_type === "Covered Call")) {
    const price = getPrice(s);
    const strike = s.sold_call_strike || 0;
    if (price > 0 && strike > 0 && price > strike) {
      // Get contracts from position
      const posId = s.position_ids?.[0];
      const pos = posId ? positions.find(p => p.id === posId) : null;
      const contracts = pos ? Math.abs(pos.quantity) : 1;
      coveredCallsITM.push({ ticker: displayTicker(s), strike, contracts });
    }
  }
  if (coveredCallsITM.length > 0) {
    coveredCallsITM.sort((a, b) => a.ticker.localeCompare(b.ticker));
    sections.push({
      title: "Covered Call",
      emoji: "amber",
      badge: "ITM",
      items: coveredCallsITM.map(cc => `${cc.ticker} $${cc.strike} ×${cc.contracts}`),
    });
  }

  // ============ 3. Double Diagonal OOR ============
  const doubleDiagonalOOR: { ticker: string; isAlternative: boolean }[] = [];
  for (const s of typedStrategies.filter(s => s.strategy_type === "Double Diagonal")) {
    const price = getPrice(s);
    if (price > 0) {
      const soldPut = s.sold_put_strike || 0;
      const soldCall = s.sold_call_strike || 0;
      if (!(price >= soldPut && price <= soldCall)) {
        doubleDiagonalOOR.push({ ticker: displayTicker(s), isAlternative: false });
      }
    }
  }
  // Alternative Double Diagonal (stored in strategy_cache with that type)
  for (const s of typedStrategies.filter(s => s.strategy_type === "Alternative Double Diagonal")) {
    const price = getPrice(s);
    if (price > 0) {
      const soldPut = s.sold_put_strike || 0;
      const soldCall = s.sold_call_strike || 0;
      if (!(price >= soldPut && price <= soldCall)) {
        doubleDiagonalOOR.push({ ticker: displayTicker(s), isAlternative: true });
      }
    }
  }
  if (doubleDiagonalOOR.length > 0) {
    doubleDiagonalOOR.sort((a, b) => a.ticker.localeCompare(b.ticker));
    sections.push({
      title: "Double Diagonal",
      emoji: "purple",
      badge: "OOR",
      items: doubleDiagonalOOR.map(dd => `${dd.ticker}${dd.isAlternative ? " (Alt)" : ""}`),
    });
  }

  // ============ 4. Iron Condor OOR ============
  const ironCondorOOR: string[] = [];
  for (const s of typedStrategies.filter(s => s.strategy_type === "Iron Condor")) {
    const price = getPrice(s);
    if (price > 0) {
      const soldPut = s.sold_put_strike || 0;
      const soldCall = s.sold_call_strike || 0;
      if (!(price >= soldPut && price <= soldCall)) {
        ironCondorOOR.push(displayTicker(s));
      }
    }
  }
  if (ironCondorOOR.length > 0) {
    ironCondorOOR.sort();
    sections.push({
      title: "Iron Condor",
      emoji: "amber",
      badge: "OOR",
      items: ironCondorOOR,
    });
  }

  // ============ 5. Naked Put ITM ============
  const nakedPutsITM: { ticker: string; strike: number; contracts: number }[] = [];
  for (const s of typedStrategies.filter(s => s.strategy_type === "Naked Put")) {
    const price = getPrice(s);
    const strike = s.sold_put_strike || 0;
    if (price > 0 && strike > 0 && strike > price) {
      const posId = s.position_ids?.[0];
      const pos = posId ? positions.find(p => p.id === posId) : null;
      const contracts = pos ? Math.abs(pos.quantity) : 1;
      nakedPutsITM.push({ ticker: displayTicker(s), strike, contracts });
    }
  }
  if (nakedPutsITM.length > 0) {
    nakedPutsITM.sort((a, b) => a.ticker.localeCompare(b.ticker));
    sections.push({
      title: "Naked Put",
      emoji: "orange",
      badge: "ITM",
      items: nakedPutsITM.map(np => `${np.ticker} $${np.strike} ×${np.contracts}`),
    });
  }

  // ============ 6. LEAP Call in Gain ============
  const leapInGain: { ticker: string; strike: number; contracts: number }[] = [];
  for (const s of typedStrategies.filter(s => s.strategy_type === "LEAP Call")) {
    // Read position data for current_price and avg_cost
    const posId = s.position_ids?.[0];
    const pos = posId ? positions.find(p => p.id === posId) : null;
    if (pos) {
      const currentPrice = pos.current_price || 0;
      const avgCost = pos.avg_cost || 0;
      if (avgCost > 0 && currentPrice > avgCost) {
        leapInGain.push({
          ticker: displayTicker(s),
          strike: pos.strike_price || 0,
          contracts: pos.quantity || 1,
        });
      }
    }
  }
  if (leapInGain.length > 0) {
    leapInGain.sort((a, b) => a.ticker.localeCompare(b.ticker));
    sections.push({
      title: "Leap Call",
      emoji: "green",
      badge: "G",
      items: leapInGain.map(lc => `${lc.ticker} $${lc.strike} ×${lc.contracts}`),
    });
  }

  // ============ 7. Altre Strategie OOR/OOB ============
  const otherOOROOB: { ticker: string; strategyName: string; status: string }[] = [];
  const handledTypes = new Set([
    "Covered Call", "Iron Condor", "Double Diagonal",
    "Naked Put", "LEAP Call", "Protezione", "Alternative Double Diagonal",
  ]);
  const rangeBasedNames = ["Short Strangle", "Put Spread", "Call Spread", "Diagonal Put Spread", "Diagonal Call Spread"];

  for (const s of typedStrategies.filter(s => !handledTypes.has(s.strategy_type))) {
    const price = getPrice(s);
    if (price <= 0) continue;

    const stratName = s.strategy_type || "Strategia";
    const isRangeBased = rangeBasedNames.some(n => stratName.includes(n));

    let isInBadState = false;
    let status: string;

    if (isRangeBased) {
      status = "OOR";
      if (stratName.includes("Short Strangle")) {
        const soldPut = s.sold_put_strike || 0;
        const soldCall = s.sold_call_strike || 0;
        if (soldPut && soldCall) {
          isInBadState = !(price >= soldPut && price <= soldCall);
        }
      } else if (stratName.includes("Put Spread") || stratName.includes("Diagonal Put Spread")) {
        const soldPut = s.sold_put_strike || 0;
        if (soldPut) {
          isInBadState = price < soldPut;
        }
      } else if (stratName.includes("Call Spread") || stratName.includes("Diagonal Call Spread")) {
        const soldCall = s.sold_call_strike || 0;
        if (soldCall) {
          isInBadState = price > soldCall;
        }
      }
    } else {
      status = "OOB";
      // Calculate total P/L from positions
      let totalPL = 0;
      for (const pid of (s.position_ids || [])) {
        const pos = positions.find(p => p.id === pid);
        if (pos && pos.market_value != null) {
          totalPL += pos.market_value;
        }
      }
      isInBadState = totalPL < 0;
    }

    if (isInBadState) {
      otherOOROOB.push({
        ticker: displayTicker(s),
        strategyName: stratName.replace("Alternative ", "").replace("Diagonal ", "Diag. "),
        status,
      });
    }
  }
  if (otherOOROOB.length > 0) {
    otherOOROOB.sort((a, b) => a.ticker.localeCompare(b.ticker));
    sections.push({
      title: "Altre Strategie",
      emoji: "cyan",
      badge: "OOR/OOB",
      items: otherOOROOB.map(os => `${os.ticker} ${os.strategyName} ${os.status}`),
    });
  }

  // ============ 8. Call da rivendere ============
  const callsToSell: { ticker: string; availableShares: number }[] = [];
  for (const stock of stockPositions) {
    const potentialContracts = Math.floor(stock.quantity / 100);
    if (potentialContracts < 1) continue;

    const stockKey = resolveStockTicker(stock.description, directMappings, normalizedMappings)
      || getMatchingKey(stock.description);

    // Count covered calls already sold on this underlying
    let soldCallContracts = 0;
    for (const s of typedStrategies.filter(s => s.strategy_type === "Covered Call")) {
      const sKey = resolveStockTicker(s.underlying, directMappings, normalizedMappings)
        || s.ticker || getMatchingKey(s.underlying);
      if (sKey === stockKey) {
        const posId = s.position_ids?.[0];
        const pos = posId ? positions.find(p => p.id === posId) : null;
        soldCallContracts += pos ? Math.abs(pos.quantity) : 1;
      }
    }

    const available = potentialContracts - soldCallContracts;
    if (available >= 1) {
      callsToSell.push({ ticker: stockKey, availableShares: available * 100 });
    }
  }
  if (callsToSell.length > 0) {
    callsToSell.sort((a, b) => b.availableShares - a.availableShares);
    sections.push({
      title: "Call da rivendere",
      emoji: "green",
      items: callsToSell.map(item => `${item.ticker} ${item.availableShares}az`),
    });
  }

  return sections;
}

// ============ MESSAGE FORMATTING ============

function formatDateIT(): string {
  const now = new Date();
  const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  return `${now.getUTCDate()} ${months[now.getUTCMonth()]} ${now.getUTCFullYear()}`;
}

function buildTelegramMessage(briefings: PortfolioBriefing[], userName?: string): string {
  let msg = `📋 *Briefing Pre-Apertura*\n📅 ${formatDateIT()}\n`;
  if (userName) {
    msg += `👤 *${userName}*\n`;
  }

  for (const pb of briefings) {
    msg += `\n📁 *${pb.portfolioName}*\n`;
    for (const section of pb.sections) {
      const emoji = EMOJI_MAP[section.emoji] || '⚪';
      const badge = section.badge ? ` [${section.badge}]` : '';
      msg += `\n${emoji} *${section.title}*${badge}\n`;
      for (const item of section.items) {
        msg += `  ${item}\n`;
      }
    }
  }

  return msg;
}

function buildEmailHTML(briefings: PortfolioBriefing[], userName?: string): string {
  let portfolioRows = '';
  for (const pb of briefings) {
    portfolioRows += `
      <tr>
        <td style="padding: 16px 0 8px 0; font-weight: bold; font-size: 16px; color: #1e40af; border-bottom: 2px solid #dbeafe;">
          📁 ${pb.portfolioName}
        </td>
      </tr>`;
    for (const section of pb.sections) {
      const emoji = EMOJI_MAP[section.emoji] || '⚪';
      const badge = section.badge ? ` <span style="font-size: 12px; color: #6b7280;">[${section.badge}]</span>` : '';
      portfolioRows += `
      <tr>
        <td style="padding: 12px 0 4px 8px; font-weight: bold; font-size: 15px;">
          ${emoji} ${section.title}${badge}
        </td>
      </tr>`;
      for (const item of section.items) {
        portfolioRows += `
      <tr>
        <td style="padding: 2px 0 2px 28px; font-size: 14px; color: #374151;">${item}</td>
      </tr>`;
      }
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
          ${portfolioRows}
        </table>
        <p style="font-size: 12px; color: #9ca3af; margin-top: 16px;">
          Generato automaticamente alle 11:00.
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

    if (!force && !isItalian11AM()) {
      console.log("Not 11:00 Italian time, skipping briefing");
      return new Response(
        JSON.stringify({ skipped: true, reason: "not_italian_11am" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    console.log("Starting daily briefing...");

    // 1. Get users with notifications enabled
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, email, full_name, notify_email, notify_telegram, telegram_chat_id");

    const notifiableUsers = (profiles || []).filter(
      (p: any) => p.notify_telegram || p.notify_email
    );

    console.log(`Found ${notifiableUsers.length} users with notifications enabled`);

    // 2. Get admin users for oversight
    const { data: adminRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const adminUserIds = new Set((adminRoles || []).map((r: any) => r.user_id));

    const { data: adminProfiles } = await supabase
      .from("profiles")
      .select("user_id, email, full_name, admin_notify_email, admin_notify_telegram, telegram_chat_id")
      .in("user_id", Array.from(adminUserIds));

    const MAX_SNAPSHOT_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours
    let totalSent = 0;

    // 3. Process each notifiable user
    for (const user of notifiableUsers) {
      // Get user's portfolios
      const { data: portfolios } = await supabase
        .from("portfolios")
        .select("id, name")
        .eq("user_id", user.user_id);

      if (!portfolios || portfolios.length === 0) continue;

      const portfolioIds = portfolios.map((p: any) => p.id);

      // Read snapshots from monitoring_snapshot
      const { data: snapshots } = await supabase
        .from("monitoring_snapshot")
        .select("portfolio_id, sections, updated_at")
        .in("portfolio_id", portfolioIds);

      // Build briefing per portfolio
      const portfolioBriefings: PortfolioBriefing[] = [];
      const now = Date.now();

      for (const portfolio of portfolios) {
        let sections: SnapshotSection[] | null = null;

        // Fallback 1: Try monitoring_snapshot (fresh < 48h)
        const snapshot = (snapshots || []).find((s: any) => s.portfolio_id === portfolio.id);
        if (snapshot) {
          const snapshotAge = now - new Date(snapshot.updated_at).getTime();
          if (snapshotAge <= MAX_SNAPSHOT_AGE_MS) {
            sections = (snapshot.sections || []) as SnapshotSection[];
            console.log(`Portfolio "${portfolio.name}": using monitoring_snapshot (${Math.round(snapshotAge / 3600000)}h old)`);
          } else {
            console.log(`Portfolio "${portfolio.name}": snapshot too old (${Math.round(snapshotAge / 3600000)}h), trying strategy_cache`);
          }
        } else {
          console.log(`Portfolio "${portfolio.name}": no snapshot found, trying strategy_cache`);
        }

        // Fallback 2: Compute from strategy_cache
        if (!sections || sections.length === 0) {
          try {
            sections = await computeSectionsFromCache(supabase, portfolio.id);
            if (sections.length > 0) {
              console.log(`Portfolio "${portfolio.name}": computed ${sections.length} sections from strategy_cache`);
            } else {
              console.log(`Portfolio "${portfolio.name}": no monitorable items from strategy_cache`);
            }
          } catch (e) {
            console.error(`Portfolio "${portfolio.name}": strategy_cache computation failed:`, e);
            sections = [];
          }
        }

        if (sections && sections.length > 0) {
          portfolioBriefings.push({ portfolioName: portfolio.name, sections });
        }
      }

      if (portfolioBriefings.length === 0) {
        console.log(`No items to monitor for user ${user.email}, skipping`);
        continue;
      }

      const userName = user.full_name || user.email;

      // Send to user
      if (user.notify_telegram && user.telegram_chat_id) {
        const msg = buildTelegramMessage(portfolioBriefings);
        const ok = await sendTelegram(user.telegram_chat_id, msg);
        if (ok) totalSent++;
      }

      if (user.notify_email && user.email) {
        const html = buildEmailHTML(portfolioBriefings);
        const ok = await sendEmail(user.email, `📋 Briefing Pre-Apertura — ${formatDateIT()}`, html);
        if (ok) totalSent++;
      }

      // Send to admins
      if (adminProfiles) {
        for (const admin of adminProfiles) {
          if (admin.user_id === user.user_id) continue;

          if (admin.admin_notify_telegram && admin.telegram_chat_id) {
            const msg = buildTelegramMessage(portfolioBriefings, userName);
            await sendTelegram(admin.telegram_chat_id, msg);
          }

          if (admin.admin_notify_email && admin.email) {
            const html = buildEmailHTML(portfolioBriefings, userName);
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
