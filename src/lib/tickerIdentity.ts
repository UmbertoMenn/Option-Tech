/**
 * Single canonical resolver for underlying-asset identity.
 * 
 * Used by:
 *  - derivativeStrategies (resolved configs)
 *  - riskCalculator (stock/NP/leap/strategy details)
 *  - sectorExposure (GP holdings, holdings consolidation)
 * 
 * Goal: one ticker key per underlying company, no matter the source
 * (stock description, option underlying, broker prefix, alias).
 */

import { Position } from '@/types/portfolio';

export type IdentitySource =
  | 'linked_stock'
  | 'raw_ticker'
  | 'alias_map'
  | 'name_match'
  | 'fallback_name';

export interface UnderlyingIdentity {
  tickerKey: string;          // Canonical aggregation key (e.g. "LULU"). Falls back to "NAME:..."
  displayTicker: string | null; // Pretty ticker (null when fallback was used)
  canonicalName: string;       // Best display name
  source: IdentitySource;
  confidence: 'high' | 'medium' | 'low';
}

export interface IdentityInput {
  rawTicker?: string | null;
  rawName?: string | null;
  underlyingName?: string | null;
  description?: string | null;
  linkedStock?: Position | null;
  isin?: string | null;
}

export interface ResolveOptions {
  /**
   * Dynamic alias map derived from the backend (e.g. `underlying_mappings`).
   * Keys MUST be already normalized via `normalizeText(...)`. Values are
   * canonical tickers (e.g. "CEG", "APP", "RDDT", "CLS").
   * Checked AFTER linkedStock/rawTicker but BEFORE the static alias map,
   * so the backend wins over hardcoded aliases when both exist.
   */
  dynamicAliases?: Map<string, string> | Record<string, string>;
}

// ============================================================================
// 1. Unified canonical map. Add new aliases here (single source of truth).
// ============================================================================

/**
 * Maps a canonical ticker → all known textual variants (uppercased, no punctuation).
 * Add aliases here as needed. Keys MUST be the canonical exchange ticker.
 */
const CANONICAL_UNDERLYINGS: Record<string, string[]> = {
  // === Tech mega-caps ===
  AAPL: ['AAPL', 'APPLE', 'APPLE INC', 'APPLE COMPUTER', 'APPLE COMPUTER INC'],
  MSFT: ['MSFT', 'MICROSOFT', 'MICROSOFT CORP', 'MICROSOFT CORPORATION'],
  NVDA: ['NVDA', 'NVIDIA', 'NVIDIA CORP', 'NVIDIA CORPORATION'],
  GOOGL: ['GOOGL', 'GOOG', 'GOOGLE', 'ALPHABET', 'ALPHABET INC', 'ALPHABET CLASS A', 'ALPHABET CLASS C', 'ALPHABET CLASS'],
  AMZN: ['AMZN', 'AMAZON', 'AMAZON COM', 'AMAZON COM INC', 'AMAZONCOM', 'AMAZON.COM', 'AMAZON.COM INC'],
  META: ['META', 'META PLATFORMS', 'META PLATFORMS INC', 'FACEBOOK'],
  TSLA: ['TSLA', 'TESLA', 'TESLA INC', 'TESLA MOTORS'],

  // === Other tech ===
  AVGO: ['AVGO', 'BROADCOM', 'BROADCOM INC'],
  ORCL: ['ORCL', 'ORACLE', 'ORACLE CORP', 'ORACLE CORPORATION'],
  CRM: ['CRM', 'SALESFORCE', 'SALESFORCE INC', 'SALESFORCE COM'],
  ADBE: ['ADBE', 'ADOBE', 'ADOBE INC', 'ADOBE SYSTEMS'],
  CSCO: ['CSCO', 'CISCO', 'CISCO SYSTEMS'],
  INTC: ['INTC', 'INTEL', 'INTEL CORP'],
  AMD: ['AMD', 'ADVANCED MICRO', 'ADVANCED MICRO DEVICES'],
  QCOM: ['QCOM', 'QUALCOMM', 'QUALCOMM INC'],
  TXN: ['TXN', 'TEXAS INSTRUMENTS'],
  NOW: ['NOW', 'SERVICENOW', 'SERVICENOW INC'],
  PANW: ['PANW', 'PALO ALTO', 'PALO ALTO NETWORKS'],
  ANET: ['ANET', 'ARISTA', 'ARISTA NETWORKS'],
  ARM: ['ARM', 'ARM HOLDINGS', 'ARM HOLDINGS PLC'],
  ALAB: ['ALAB', 'ASTERA', 'ASTERA LABS'],
  WDC: ['WDC', 'WESTERN DIGITAL', 'WESTERN DIGITAL CORP'],
  STX: ['STX', 'SEAGATE', 'SEAGATE TECHNOLOGY'],
  MU: ['MU', 'MICRON', 'MICRON TECHNOLOGY'],
  SMCI: ['SMCI', 'SUPER MICRO', 'SUPERMICRO', 'SUPER MICRO COMPUTER'],

  // === Communication services ===
  NFLX: ['NFLX', 'NETFLIX', 'NETFLIX INC'],
  DIS: ['DIS', 'DISNEY', 'WALT DISNEY', 'WALT DISNEY CO'],
  SPOT: ['SPOT', 'SPOTIFY', 'SPOTIFY TECHNOLOGY'],
  SNAP: ['SNAP', 'SNAPCHAT', 'SNAP INC'],
  PINS: ['PINS', 'PINTEREST', 'PINTEREST INC'],
  RBLX: ['RBLX', 'ROBLOX', 'ROBLOX CORP'],
  TTWO: ['TTWO', 'TAKE TWO', 'TAKE-TWO', 'TAKE TWO INTERACTIVE'],
  EA: ['EA', 'ELECTRONIC ARTS'],

  // === Financials ===
  V: ['V', 'VISA', 'VISA INC'],
  MA: ['MA', 'MASTERCARD', 'MASTERCARD INC'],
  JPM: ['JPM', 'JPMORGAN', 'JP MORGAN', 'JPMORGAN CHASE', 'J P MORGAN', 'JP MORGAN CHASE'],
  GS: ['GS', 'GOLDMAN', 'GOLDMAN SACHS', 'GOLDMAN SACHS GROUP'],
  'BRK.B': ['BRK B', 'BRK.B', 'BERKSHIRE', 'BERKSHIRE HATHAWAY', 'BERKSHIRE HATHAWAY B'],
  PYPL: ['PYPL', 'PAYPAL', 'PAYPAL HOLDINGS'],
  SQ: ['SQ', 'BLOCK', 'BLOCK INC', 'SQUARE', 'SQUARE INC'],
  HOOD: ['HOOD', 'ROBINHOOD', 'ROBINHOOD MARKETS'],
  SOFI: ['SOFI', 'SOFI TECHNOLOGIES'],
  COIN: ['COIN', 'COINBASE', 'COINBASE GLOBAL'],
  AFRM: ['AFRM', 'AFFIRM', 'AFFIRM HOLDINGS'],
  UPST: ['UPST', 'UPSTART', 'UPSTART HOLDINGS'],

  // === Healthcare ===
  UNH: ['UNH', 'UNITEDHEALTH', 'UNITEDHEALTH GROUP', 'UNITEDHEALTH GR'],
  JNJ: ['JNJ', 'JOHNSON', 'JOHNSON JOHNSON', 'JOHNSON AND JOHNSON'],
  LLY: ['LLY', 'ELI LILLY', 'LILLY'],
  HIMS: ['HIMS', 'HIMS HERS', 'HIMS AND HERS', 'HIMS & HERS'],

  // === Consumer ===
  WMT: ['WMT', 'WALMART', 'WAL MART'],
  KO: ['KO', 'COCA COLA', 'COCA-COLA', 'COCACOLA', 'THE COCA COLA'],
  PEP: ['PEP', 'PEPSI', 'PEPSICO', 'PEPSICO INC'],
  PG: ['PG', 'PROCTER', 'PROCTER GAMBLE', 'PROCTER AND GAMBLE'],
  NKE: ['NKE', 'NIKE', 'NIKE INC'],
  LULU: ['LULU', 'LULULEMON', 'LULULEMON ATHLETICA', 'LULULEMON ATHLETICA INC'],
  MCD: ['MCD', 'MCDONALD', 'MCDONALDS', 'MCDONALD S', 'MCDONALDS CORP'],
  SBUX: ['SBUX', 'STARBUCKS', 'STARBUCKS CORP'],

  // === Energy ===
  XOM: ['XOM', 'EXXON', 'EXXON MOBIL', 'EXXONMOBIL'],
  CVX: ['CVX', 'CHEVRON', 'CHEVRON CORP'],
  ENI: ['ENI', 'ENI SPA', 'ENI STOCK'],

  // === China / ADR ===
  BABA: ['BABA', 'ALIBABA', 'ALIBABA GROUP', 'ALIBABA GROUP HOLDING'],
  PDD: ['PDD', 'PINDUODUO', 'PDD HOLDINGS', 'PINDUODUO INC', 'PDD HOLDINGS INC'],
  NTES: ['NTES', 'NETEASE', 'NETEASE INC'],
  BIDU: ['BIDU', 'BAIDU', 'BAIDU INC'],

  // === Crypto / mining ===
  MSTR: ['MSTR', 'MICROSTRATEGY', 'STRATEGY', 'STRATEGY INC'],
  MARA: ['MARA', 'MARATHON', 'MARATHON DIGITAL', 'MARATHON DIGITAL HOLDINGS'],
  RIOT: ['RIOT', 'RIOT PLATFORMS', 'RIOT BLOCKCHAIN'],
  IREN: ['IREN', 'IRIS ENERGY'],
  CRWV: ['CRWV', 'COREWEAVE'],
  APLD: ['APLD', 'APPLIED DIGITAL'],
  NBIS: ['NBIS', 'NEBIUS', 'NEBIUS GROUP'],

  // === AI / quantum ===
  PLTR: ['PLTR', 'PALANTIR', 'PALANTIR TECHNOLOGIES'],
  SOUN: ['SOUN', 'SOUNDHOUND', 'SOUNDHOUND AI'],
  IONQ: ['IONQ', 'IONQ INC'],
  RGTI: ['RGTI', 'RIGETTI', 'RIGETTI COMPUTING'],
  QUBT: ['QUBT', 'QUANTUM COMPUTING'],
  QBTS: ['QBTS', 'D WAVE', 'D-WAVE', 'DWAVE'],

  // === Energy / nuclear ===
  SMR: ['SMR', 'NUSCALE', 'NUSCALE POWER'],
  CCJ: ['CCJ', 'CAMECO', 'CAMECO CORP'],
  UEC: ['UEC', 'URANIUM ENERGY'],
  LEU: ['LEU', 'CENTRUS', 'CENTRUS ENERGY'],
  DNN: ['DNN', 'DENISON', 'DENISON MINES'],
  NXE: ['NXE', 'NEXGEN', 'NEXGEN ENERGY'],

  // === Cybersecurity / cloud / SaaS (extra) ===
  FTNT: ['FTNT', 'FORTINET', 'FORTINET INC'],
  CRWD: ['CRWD', 'CROWDSTRIKE', 'CROWDSTRIKE HOLDINGS'],
  ZS: ['ZS', 'ZSCALER', 'ZSCALER INC'],
  NET: ['NET', 'CLOUDFLARE', 'CLOUDFLARE INC'],
  SNOW: ['SNOW', 'SNOWFLAKE', 'SNOWFLAKE INC'],
  DDOG: ['DDOG', 'DATADOG', 'DATADOG INC'],
  MDB: ['MDB', 'MONGODB', 'MONGODB INC'],
  DOCU: ['DOCU', 'DOCUSIGN', 'DOCUSIGN INC'],
  TWLO: ['TWLO', 'TWILIO', 'TWILIO INC'],
  OKTA: ['OKTA', 'OKTA INC'],
  U: ['U', 'UNITY', 'UNITY SOFTWARE'],

  // === European stocks (cross-listed / local exchanges) ===
  RACE: ['RACE', 'FERRARI', 'FERRARI NV', 'FERRARI N V'],
  STLA: ['STLA', 'STELLANTIS', 'STELLANTIS NV', 'STELLANTIS N V'],
  MBG: ['MBG', 'MERCEDES', 'MERCEDES BENZ', 'MERCEDES BENZ GROUP', 'MERCEDES BENZ GROUP AG'],
  DPW: ['DPW', 'DEUTSCHE POST', 'DEUTSCHE POST AG', 'DHL GROUP'],
  SAP: ['SAP', 'SAP SE', 'SAP AG'],
  TIT: ['TIT', 'TELECOM ITALIA', 'TELECOM ITALIA SPA', 'DIR TELECOM ITALIA', 'DIR TELECOM ITALIA SPA'],
  ISP: ['ISP', 'INTESA', 'INTESA SANPAOLO', 'INTESA SANPAOLO SPA'],
  UCG: ['UCG', 'UNICREDIT', 'UNICREDIT SPA'],
  G: ['G', 'GENERALI', 'ASSICURAZIONI GENERALI', 'GENERALI ASSICURAZIONI'],

  // === HK / China dual-listings ===
  BYD: ['BYD', 'BYD CO', 'BYD CO LTD', 'BYD COMPANY'],
};

/**
 * Mapping from non-US/exchange-suffixed raw tickers to canonical underlying.
 * Used when a raw ticker like "1211.HK", "9PDA.SG", "RACE.MI" cannot be
 * cleaned to a normal symbol but corresponds to a known underlying.
 * Keys must be uppercased exactly as they appear after AZ. prefix stripping.
 */
const EXCHANGE_TICKER_TO_CANONICAL: Record<string, string> = {
  '1211.HK': 'BYD',
  '9PDA.SG': 'PDD',
  'RACE.MI': 'RACE',
  'STLA.MI': 'STLA',
  'STLAM.MI': 'STLA',
  'MBG.DE': 'MBG',
  'MBG.F': 'MBG',
  'DHL.DE': 'DPW',
  'DPW.DE': 'DPW',
  'SAP.DE': 'SAP',
  'SAP.F': 'SAP',
  'TIT.MI': 'TIT',
  'ISP.MI': 'ISP',
  'UCG.MI': 'UCG',
  'G.MI': 'G',
  'ENI.MI': 'ENI',
};

// ============================================================================
// 2. Reverse index for fast alias lookup
// ============================================================================

const ALIAS_TO_TICKER: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [ticker, aliases] of Object.entries(CANONICAL_UNDERLYINGS)) {
    m.set(ticker.toUpperCase(), ticker);
    for (const alias of aliases) {
      m.set(normalizeText(alias), ticker);
    }
  }
  return m;
})();

// ============================================================================
// 3. Helpers
// ============================================================================

/** Normalize free text for matching (uppercase, strip punctuation/suffixes). */
export function normalizeText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .toUpperCase()
    .replace(/^AZ\./i, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\b(INC|CORP|CORPORATION|LTD|LIMITED|CLASS\s*[A-Z]?|CL\s*[A-Z]?|COMMON|STOCK|THE|ADR|ADS|SPA|AG|SA|NV|PLC|HOLDING|HOLDINGS|GROUP|GMBH|LLC|LP)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip exchange suffixes / broker prefixes from a raw ticker candidate. */
export function normalizeTickerCandidate(raw: string | null | undefined): string {
  if (!raw) return '';
  let t = raw.trim().toUpperCase();
  t = t.replace(/^AZ\./, '');
  // Strip exchange suffixes: AAPL.US, SAP.DE, AAPL:US
  t = t.split(/[.:]/)[0];
  return t.trim();
}

/**
 * True only when the candidate looks like a real underlying ticker symbol
 * (1-6 alphanumerics, not a long option-contract symbol).
 */
export function isLikelyUnderlyingTicker(candidate: string): boolean {
  if (!candidate) return false;
  if (!/^[A-Z][A-Z0-9]{0,5}$/.test(candidate)) return false;
  // Common option contract symbols are much longer (e.g. "AAPL240119C00150000")
  return candidate.length <= 6;
}

/** Look up alias map. Returns canonical ticker or null. */
function lookupAlias(text: string): string | null {
  const norm = normalizeText(text);
  if (!norm) return null;
  // Direct exact lookup
  const direct = ALIAS_TO_TICKER.get(norm);
  if (direct) return direct;
  // Try collapsed (no spaces)
  const collapsed = norm.replace(/\s+/g, '');
  const directCollapsed = ALIAS_TO_TICKER.get(collapsed);
  if (directCollapsed) return directCollapsed;
  // Token-based: any single token is a ticker key?
  const tokens = norm.split(/\s+/).filter(t => t.length >= 2);
  for (const tk of tokens) {
    if (CANONICAL_UNDERLYINGS[tk]) return tk;
  }
  // Phrase containment: alias appears as substring (longest first wins)
  const aliases = Array.from(ALIAS_TO_TICKER.keys()).sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    if (alias.length < 4) continue; // avoid spurious 2-letter matches
    if (norm === alias) return ALIAS_TO_TICKER.get(alias)!;
    if (norm.includes(` ${alias} `) || norm.startsWith(`${alias} `) || norm.endsWith(` ${alias}`)) {
      return ALIAS_TO_TICKER.get(alias)!;
    }
  }
  return null;
}

function pickCanonicalName(input: IdentityInput, ticker: string): string {
  const candidates = [
    input.linkedStock?.description,
    input.rawName,
    input.underlyingName,
    input.description,
  ].filter((c): c is string => !!c && c.trim().length > 0);
  // Prefer the longest "clean" name (strips AZ. prefix)
  const cleaned = candidates.map(c => c.replace(/^AZ\./i, '').trim());
  if (cleaned.length === 0) return ticker;
  cleaned.sort((a, b) => b.length - a.length);
  return cleaned[0];
}

// ============================================================================
// 4. Main resolver
// ============================================================================

/**
 * Resolve the canonical underlying identity from any combination of inputs.
 * 
 * Priority:
 *   1. linkedStock (matched by strategy engine — most reliable)
 *   2. Validated raw ticker that maps via the alias map
 *   3. Validated raw ticker as-is
 *   4. Alias / name match on description / underlyingName / rawName
 *   5. Fallback: NAME:... key (deterministic)
 */
export function resolveUnderlyingIdentity(
  input: IdentityInput,
  options?: ResolveOptions,
): UnderlyingIdentity {
  const dynLookup = (text: string | null | undefined): string | null => {
    if (!options?.dynamicAliases || !text) return null;
    const norm = normalizeText(text);
    if (!norm) return null;
    const map = options.dynamicAliases instanceof Map
      ? options.dynamicAliases
      : new Map(Object.entries(options.dynamicAliases));
    // 1. Exact normalized match
    const exact = map.get(norm);
    if (exact) return exact;
    // 2. Whole-word substring fallback: if any alias key is contained as a
    //    word-bounded prefix in `norm` (e.g. "vertiv holdings" ⊂
    //    "vertiv holdings co"), use it. Pick the longest match for specificity.
    const tokens = norm.split(/\s+/).filter(Boolean);
    let best: { key: string; ticker: string } | null = null;
    for (const [key, ticker] of map.entries()) {
      if (!key) continue;
      const keyTokens = key.split(/\s+/).filter(Boolean);
      if (keyTokens.length === 0 || keyTokens.length > tokens.length) continue;
      // Require keyTokens to appear as a contiguous sequence inside tokens
      let matched = false;
      for (let i = 0; i + keyTokens.length <= tokens.length; i++) {
        let ok = true;
        for (let j = 0; j < keyTokens.length; j++) {
          if (tokens[i + j] !== keyTokens[j]) { ok = false; break; }
        }
        if (ok) { matched = true; break; }
      }
      if (matched && (!best || key.length > best.key.length)) {
        best = { key, ticker };
      }
    }
    return best ? best.ticker : null;
  };

  // 0. Exchange-suffixed raw ticker → canonical (highest priority for non-US tickers)
  const rawTickerExchangeKey = (input.rawTicker || input.linkedStock?.ticker || '')
    .trim()
    .toUpperCase()
    .replace(/^AZ\./, '');
  if (rawTickerExchangeKey && EXCHANGE_TICKER_TO_CANONICAL[rawTickerExchangeKey]) {
    const canonical = EXCHANGE_TICKER_TO_CANONICAL[rawTickerExchangeKey];
    return {
      tickerKey: canonical,
      displayTicker: canonical,
      canonicalName: pickCanonicalName(input, canonical),
      source: 'alias_map',
      confidence: 'high',
    };
  }

  // 1. linkedStock wins
  if (input.linkedStock) {
    const stk = input.linkedStock;
    const tk = normalizeTickerCandidate(stk.ticker);
    if (tk && isLikelyUnderlyingTicker(tk)) {
      const aliasHit = ALIAS_TO_TICKER.get(tk) || tk;
      return {
        tickerKey: aliasHit,
        displayTicker: aliasHit,
        canonicalName: pickCanonicalName({ ...input, linkedStock: stk }, aliasHit),
        source: 'linked_stock',
        confidence: 'high',
      };
    }
    // linked stock without clean ticker → try alias on description
    const aliasFromDesc = lookupAlias(stk.description || '');
    if (aliasFromDesc) {
      return {
        tickerKey: aliasFromDesc,
        displayTicker: aliasFromDesc,
        canonicalName: pickCanonicalName(input, aliasFromDesc),
        source: 'linked_stock',
        confidence: 'high',
      };
    }
  }

  // 2 + 3. Raw ticker
  const candidate = normalizeTickerCandidate(input.rawTicker);
  if (candidate && isLikelyUnderlyingTicker(candidate)) {
    const aliasHit = ALIAS_TO_TICKER.get(candidate);
    if (aliasHit) {
      return {
        tickerKey: aliasHit,
        displayTicker: aliasHit,
        canonicalName: pickCanonicalName(input, aliasHit),
        source: 'alias_map',
        confidence: 'high',
      };
    }
    // Plain ticker without alias entry
    return {
      tickerKey: candidate,
      displayTicker: candidate,
      canonicalName: pickCanonicalName(input, candidate),
      source: 'raw_ticker',
      confidence: 'medium',
    };
  }

  // 3.5 Dynamic backend mapping (underlying_mappings) — wins over static alias map.
  const textCandidatesEarly = [input.underlyingName, input.rawName, input.description, input.linkedStock?.description]
    .filter((c): c is string => !!c && c.trim().length > 0);
  for (const txt of textCandidatesEarly) {
    const dynHit = dynLookup(txt);
    if (dynHit) {
      return {
        tickerKey: dynHit.toUpperCase(),
        displayTicker: dynHit.toUpperCase(),
        canonicalName: pickCanonicalName(input, dynHit),
        source: 'alias_map',
        confidence: 'high',
      };
    }
  }

  // 4. Alias / name match across all textual hints (static map)
  const textCandidates = textCandidatesEarly;
  for (const txt of textCandidates) {
    const hit = lookupAlias(txt);
    if (hit) {
      return {
        tickerKey: hit,
        displayTicker: hit,
        canonicalName: pickCanonicalName(input, hit),
        source: 'name_match',
        confidence: 'high',
      };
    }
  }

  // 4b. Try first uppercase short token of description as a ticker
  for (const txt of textCandidates) {
    const norm = normalizeText(txt);
    const first = norm.split(/\s+/)[0];
    if (first && isLikelyUnderlyingTicker(first)) {
      const aliasHit = ALIAS_TO_TICKER.get(first);
      if (aliasHit) {
        return {
          tickerKey: aliasHit,
          displayTicker: aliasHit,
          canonicalName: pickCanonicalName(input, aliasHit),
          source: 'name_match',
          confidence: 'medium',
        };
      }
    }
  }

  // 5. Deterministic fallback
  const fallbackName = pickCanonicalName(input, '') || 'UNKNOWN';
  const normalizedFallback = normalizeText(fallbackName) || fallbackName.toUpperCase();
  return {
    tickerKey: `NAME:${normalizedFallback}`,
    displayTicker: null,
    canonicalName: fallbackName,
    source: 'fallback_name',
    confidence: 'low',
  };
}

/** Convenience: just the canonical ticker key. */
export function getCanonicalTickerKey(input: IdentityInput, options?: ResolveOptions): string {
  return resolveUnderlyingIdentity(input, options).tickerKey;
}

/** Display ticker (null when fallback). */
export function getDisplayTickerForKey(tickerKey: string): string | null {
  if (!tickerKey || tickerKey === 'UNKNOWN') return null;
  if (tickerKey.startsWith('NAME:')) return null;
  return tickerKey;
}

/**
 * Build a normalized lookup map from `underlying_mappings` rows.
 * Keys are normalized via `normalizeText` so they match anything the resolver
 * sees from descriptions/underlying names.
 */
export function buildDynamicAliasMap(
  rows: Array<{ underlying: string; ticker: string }>,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    if (!r.underlying || !r.ticker) continue;
    const norm = normalizeText(r.underlying);
    if (!norm) continue;
    // First write wins to keep things deterministic
    if (!m.has(norm)) m.set(norm, r.ticker.toUpperCase());
  }
  return m;
}
