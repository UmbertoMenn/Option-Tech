/**
 * useStressLab — orchestrazione dati per lo Stress Lab.
 *
 * Trasforma le posizioni del portafoglio + cache prezzi + beta nel formato
 * che lo "stressLab" puro è in grado di calcolare. Tutto memoizzato su
 * React Query: i fetch non si ripetono ad ogni movimento di slider.
 */

import { useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useUnderlyingPrices } from '@/hooks/useUnderlyingPrices';
import { useGPHoldings } from '@/hooks/useGPHoldings';
import { normalizeUnderlying } from '@/hooks/useUnderlyingMappings';
import { Position } from '@/types/portfolio';
import {
  StressLeg,
  StressEquity,
  StressUnderlyingMap,
  ForexRates,
  yearsToExpiry,
  isPriceBelowIntrinsic,
  impliedVolFromPrice,
  effIVMap,
} from '@/lib/stressLab';

// Ticker pulito (es. AAPL, GOOGL, ENI.MI, ^TNX) — no spazi/virgole/parentesi
const VALID_TICKER_RE = /^[A-Z0-9.\-^=]{1,12}$/;

/* ===========================================================================
 * COSTANTI / DEFAULT
 * ========================================================================= */

const DEFAULT_OPT_MULT = 100; // moltiplicatore opzioni US
const DEFAULT_RISK_FREE = 0.04; // fallback se ticker_fundamentals non popolato
const DEFAULT_BETA_UNKNOWN = 1.0; // fallback prudente se beta non disponibile
const DEFAULT_HKD_RATE = 9.043; // HKD per 1 EUR (fallback)
const DEFAULT_USD_RATE = 1.15; // USD per 1 EUR (fallback se nessuna posizione USD)

/* ===========================================================================
 * TIPI
 * ========================================================================= */

export interface StressLabInputs {
  /** Includi bond nel patrimonio MTM (default ON; fuori dallo shock) */
  includeBonds: boolean;
  /** Includi cash nel patrimonio MTM (default ON; fuori dallo shock) */
  includeCash: boolean;
  /** Includi oro/commodity nel patrimonio MTM (default ON; fuori dallo shock se beta=0) */
  includeCommodity: boolean;
  /** Includi posizioni GP nel patrimonio (default OFF: GP separato) */
  includeGPInPatrimony: boolean;
  /** Includi posizioni GP nello shock di mercato (default OFF) */
  includeGPInShock: boolean;
}

export interface BetaRow {
  ticker: string;
  beta: number | null;
  beta_source: string | null;
  rv: number | null;
  risk_free: number | null;
}

export interface StressLabData {
  /** Strutture pronte per runScenario / occMargin */
  legs: StressLeg[];
  eq: StressEquity[];
  unders: StressUnderlyingMap;
  fx: ForexRates;
  effIV: Record<number, number>;
  /** Patrimonio MTM di base (EUR), già al netto/con i toggle applicati */
  ptfBaseMTM: number;
  /** Risk-free aggregato (default 4%) */
  riskFree: number;
  /** Numero di gambe per cui non è stato possibile calcolare l'IV */
  ivWarnings: number;
  /** Lista ticker per cui il beta non è disponibile (per warning UI) */
  missingBetaTickers: string[];
  /** Metadati per la UI: caricamento e stato */
  isLoading: boolean;
  isFetchingBeta: boolean;
  /** Override editabili dei sottostanti (spot e beta) — viene gestito dalla UI */
  baselineUnders: StressUnderlyingMap;
  /** Breakdown patrimonio per debug/UI */
  patrimonyBreakdown: {
    derivativesEUR: number;
    stocksEUR: number;
    etfEUR: number;
    bondsEUR: number;
    commodityEUR: number;
    cashEUR: number;
    gpEUR: number;
  };
}

/* ===========================================================================
 * HELPERS
 * ========================================================================= */

/** Normalizza un ticker: uppercase, trim */
function normTick(t?: string | null): string {
  return (t || '').toUpperCase().trim();
}

/**
 * Estrae il ticker da una posizione opzione. NB: spesso `p.underlying` è il
 * nome grezzo del sottostante (es. "APPLE COMPUTER, INC.") e va risolto a
 * ticker pulito tramite `underlying_mappings`. Questa è la versione "raw"
 * che fa solo trim; per la risoluzione vera si veda `makeUnderlyingResolver`
 * dentro `useStressLab`.
 */
function getRawOptionUnderlyingKey(p: Position): string {
  const u = normTick(p.underlying);
  if (u) return u;
  return normTick(p.ticker);
}

/** Determina la valuta nativa dell'opzione (per il cambio in EUR) */
function getOptionCurrency(p: Position): string {
  // Per default le opzioni US quotano USD; se la posizione ha currency specifico, lo usa
  return (p.currency || 'USD').toUpperCase();
}

/* ===========================================================================
 * HOOK
 * ========================================================================= */

export function useStressLab(inputs: StressLabInputs): StressLabData {
  const { positions, portfolio, isLoading: isLoadingPortfolio } = usePortfolio();
  const { gpHoldings } = useGPHoldings();

  /* ---------- 1. Suddivisione posizioni per asset_type ---------- */

  const derivatives = useMemo(
    () => (positions || []).filter((p) => p.asset_type === 'derivative'),
    [positions],
  );

  const stocks = useMemo(
    () => (positions || []).filter((p) => p.asset_type === 'stock'),
    [positions],
  );

  const etfs = useMemo(
    () => (positions || []).filter((p) => p.asset_type === 'etf'),
    [positions],
  );

  const commodities = useMemo(
    () => (positions || []).filter((p) => p.asset_type === 'commodity'),
    [positions],
  );

  const bonds = useMemo(
    () => (positions || []).filter((p) => p.asset_type === 'bond'),
    [positions],
  );

  /* ---------- 2. Cambio EUR/USD: prima posizione USD non-derivata ---------- */

  const fx: ForexRates = useMemo(() => {
    // Cerco un exchange_rate in qualsiasi posizione USD (preferenza: stock/etf, poi derivati)
    const candidates = [
      ...stocks,
      ...etfs,
      ...commodities,
      ...bonds,
      ...derivatives,
    ].filter((p) => (p.currency || '').toUpperCase() === 'USD' && p.exchange_rate && p.exchange_rate > 0);

    const usdRate = candidates.length > 0 ? candidates[0].exchange_rate! : DEFAULT_USD_RATE;

    // HKD: stesso schema; fallback al default
    const hkdCand = [...stocks, ...etfs, ...commodities, ...bonds, ...derivatives].find(
      (p) => (p.currency || '').toUpperCase() === 'HKD' && p.exchange_rate && p.exchange_rate > 0,
    );
    const hkdRate = hkdCand?.exchange_rate ?? DEFAULT_HKD_RATE;

    return { USD: usdRate, HKD: hkdRate };
  }, [stocks, etfs, commodities, bonds, derivatives]);

  /* ---------- 3a. Risoluzione underlying→ticker (riuso underlying_mappings) ---------- */

  const mappingsQuery = useQuery({
    queryKey: ['stress-lab-underlying-mappings'],
    queryFn: async () => {
      const [m, up] = await Promise.all([
        supabase.from('underlying_mappings').select('underlying, ticker'),
        supabase.from('underlying_prices').select('ticker'),
      ]);
      return {
        mappings: m.data ?? [],
        knownTickers: new Set((up.data ?? []).map((r: any) => String(r.ticker).toUpperCase())),
      };
    },
    staleTime: 60 * 60 * 1000,
  });

  const resolveUnderlying = useCallback(
    (raw: string | null | undefined): string => {
      if (!raw) return '';
      const up = String(raw).toUpperCase().trim();
      const data = mappingsQuery.data;
      // PRIORITÀ AI MAPPINGS: anche se "RAMBUS" passa VALID_TICKER_RE, il
      // mapping RAMBUS->RMBS deve avere la precedenza per evitare beta=1.0 default.
      if (data) {
        const direct =
          data.mappings.find((m: any) => String(m.underlying).toUpperCase() === up) ||
          data.mappings.find((m: any) => m.underlying === raw);
        if (direct) return String(direct.ticker).toUpperCase();
        const normKey = normalizeUnderlying(raw);
        const norm = data.mappings.find(
          (m: any) => normalizeUnderlying(m.underlying) === normKey,
        );
        if (norm) return String(norm.ticker).toUpperCase();
      }
      // Fallback: se è un ticker formalmente valido lo accettiamo
      if (VALID_TICKER_RE.test(up)) return up;
      return '';
    },
    [mappingsQuery.data],
  );

  /** Versione risolta di getRawOptionUnderlyingKey */
  const getOptionUnderlyingKey = useCallback(
    (p: Position): string => {
      const fromUnd = resolveUnderlying(p.underlying);
      if (fromUnd) return fromUnd;
      const fromTk = normTick(p.ticker);
      if (fromTk && VALID_TICKER_RE.test(fromTk)) return fromTk;
      return '';
    },
    [resolveUnderlying],
  );

  /* ---------- 3. Tickers che ci servono: derivati + equity ---------- */

  const allTickers = useMemo(() => {
    const set = new Set<string>();
    derivatives.forEach((d) => {
      const k = getOptionUnderlyingKey(d);
      if (k && VALID_TICKER_RE.test(k)) set.add(k);
    });
    [...stocks, ...etfs, ...commodities].forEach((s) => {
      const t = normTick(s.ticker);
      if (t && VALID_TICKER_RE.test(t)) set.add(t);
    });
    return [...set].sort();
  }, [derivatives, stocks, etfs, commodities, getOptionUnderlyingKey]);

  /* ---------- 4. Spot prices via useUnderlyingPrices ---------- */

  // Use the original strings (description if no ticker) so the hook can do its name-based lookup
  const underlyingNamesForPrices = useMemo(() => {
    const set = new Set<string>();
    derivatives.forEach((d) => {
      const name = d.underlying || d.description;
      if (name) set.add(name);
    });
    return [...set];
  }, [derivatives]);

  const { prices: underlyingPrices, isLoading: isLoadingPrices, isFetchingMissing } =
    useUnderlyingPrices(underlyingNamesForPrices);

  /* ---------- 5. Beta + risk-free: ticker_fundamentals + on-demand fetch ---------- */

  const tickersKey = allTickers.join('|');

  const betasQuery = useQuery<BetaRow[]>({
    queryKey: ['stress-lab-betas', tickersKey],
    queryFn: async () => {
      if (allTickers.length === 0) return [];
      const { data, error } = await supabase
        .from('ticker_fundamentals')
        .select('ticker, beta, beta_source, rv, risk_free')
        .in('ticker', allTickers);
      if (error) throw error;
      return (data as BetaRow[]) ?? [];
    },
    enabled: allTickers.length > 0,
    staleTime: 60 * 60 * 1000, // 1h
  });

  /* ---------- 5b. Fetch on-demand per i ticker senza beta ---------- */

  const missingBetaTickers = useMemo(() => {
    if (!betasQuery.data) return [];
    const have = new Set(
      betasQuery.data.filter((r) => r.beta != null).map((r) => normTick(r.ticker)),
    );
    return allTickers.filter((t) => !have.has(t));
  }, [betasQuery.data, allTickers]);

  const missingBetaKey = missingBetaTickers.join('|');

  const fetchedBetasQuery = useQuery<BetaRow[]>({
    queryKey: ['stress-lab-fetch-missing-betas', missingBetaKey],
    queryFn: async () => {
      if (missingBetaTickers.length === 0) return [];
      // Invoco l'edge function in parallelo (massimo 8 alla volta per non saturare)
      const out: BetaRow[] = [];
      const chunk = (arr: string[], n: number) => {
        const r: string[][] = [];
        for (let i = 0; i < arr.length; i += n) r.push(arr.slice(i, i + n));
        return r;
      };
      for (const batch of chunk(missingBetaTickers, 8)) {
        const results = await Promise.all(
          batch.map(async (tk) => {
            try {
              const { data, error } = await supabase.functions.invoke(
                'fetch-ticker-fundamentals',
                { body: { ticker: tk } },
              );
              if (error || !data) return null;
              return {
                ticker: tk,
                beta: typeof data.beta === 'number' ? data.beta : null,
                beta_source: data.betaSource ?? null,
                rv: typeof data.rv === 'number' ? data.rv : null,
                risk_free: typeof data.riskFree === 'number' ? data.riskFree / 100 : null,
              } as BetaRow;
            } catch {
              return null;
            }
          }),
        );
        results.forEach((r) => r && out.push(r));
      }
      return out;
    },
    enabled: missingBetaTickers.length > 0 && betasQuery.isSuccess,
    staleTime: 24 * 60 * 60 * 1000, // 24h
  });

  /* ---------- 6. Beta map unificato (cache + fetched) ---------- */

  const betaMap = useMemo(() => {
    const m: Record<string, number> = {};
    (betasQuery.data || []).forEach((r) => {
      if (r.beta != null) m[normTick(r.ticker)] = r.beta;
    });
    (fetchedBetasQuery.data || []).forEach((r) => {
      if (r.beta != null && m[normTick(r.ticker)] == null) {
        m[normTick(r.ticker)] = r.beta;
      }
    });
    return m;
  }, [betasQuery.data, fetchedBetasQuery.data]);

  /* ---------- 7. Risk-free aggregato (media dei ticker con risk_free) ---------- */

  const riskFree = useMemo(() => {
    const rfs = (betasQuery.data || [])
      .map((r) => r.risk_free)
      .filter((x): x is number => typeof x === 'number' && x > 0 && x < 1);
    if (!rfs.length) return DEFAULT_RISK_FREE;
    return rfs.reduce((a, b) => a + b, 0) / rfs.length;
  }, [betasQuery.data]);

  /* ---------- 8. Mappa sottostanti unders (S, beta) ---------- */

  const baselineUnders: StressUnderlyingMap = useMemo(() => {
    const m: StressUnderlyingMap = {};

    // a) Spot dai prezzi underlying (per i derivati)
    derivatives.forEach((d) => {
      const key = getOptionUnderlyingKey(d);
      if (!key) return;
      // Spot: prima provo dal cache (per nome esatto)
      const lookupName = d.underlying || d.description;
      const cached = lookupName ? underlyingPrices[lookupName] : undefined;
      const spot = cached?.price;
      if (spot && spot > 0 && !m[key]) {
        m[key] = { S: spot, beta: betaMap[key] ?? DEFAULT_BETA_UNKNOWN };
      }
    });

    // b) Spot dalle posizioni stock/etf (snapshot price o current price)
    [...stocks, ...etfs, ...commodities].forEach((s) => {
      const t = normTick(s.ticker);
      if (!t) return;
      const px = s.snapshot_price ?? s.current_price;
      if (typeof px === 'number' && px > 0 && !m[t]) {
        m[t] = { S: px, beta: betaMap[t] ?? DEFAULT_BETA_UNKNOWN };
      }
    });

    // c) EUR/USD: spot = 1/fx.USD * fx.USD? No: lo "spot" di EURUSD è quante USD per 1 EUR = fx.USD
    m['EURUSD'] = { S: fx.USD, beta: 0 };

    return m;
  }, [derivatives, stocks, etfs, commodities, underlyingPrices, betaMap, fx.USD, getOptionUnderlyingKey]);

  /* ---------- 9. Costruzione legs (con IV calcolata) ---------- */

  const legs: StressLeg[] = useMemo(() => {
    const out: StressLeg[] = [];
    derivatives.forEach((d) => {
      const key = getOptionUnderlyingKey(d);
      const und = baselineUnders[key];
      if (!und) return; // impossibile lavorare senza spot
      if (!d.strike_price || !d.expiry_date || !d.option_type) return;
      const px = d.snapshot_price ?? d.current_price;
      if (typeof px !== 'number' || px <= 0) return;
      const T = yearsToExpiry(d.expiry_date);
      if (T <= 0) return; // gambe scadute le scartiamo

      const isCall = d.option_type === 'call';
      const fl = isPriceBelowIntrinsic(px, und.S, d.strike_price, isCall);
      // IV: bisezione; se sotto intrinseco userà la mediana del sottostante
      const iv = fl
        ? 0.45
        : impliedVolFromPrice(px, und.S, d.strike_price, T, riskFree, isCall);

      out.push({
        u: key,
        cp: isCall ? 'C' : 'P',
        K: d.strike_price,
        T,
        exp: d.expiry_date,
        q: d.quantity,
        px,
        fl: fl || isNaN(iv),
        mult: DEFAULT_OPT_MULT,
        nm: d.description || key,
        iv: isNaN(iv) ? 0.45 : iv,
      });
    });
    return out;
  }, [derivatives, baselineUnders, riskFree, getOptionUnderlyingKey]);

  const effIV = useMemo(() => effIVMap(legs), [legs]);

  /* ---------- 10. Costruzione eq (stocks, ETF, commodity) ---------- */

  const eq: StressEquity[] = useMemo(() => {
    const buildFromPosition = (p: Position, betaOverride?: number): StressEquity | null => {
      const px = p.snapshot_price ?? p.current_price;
      const mv = p.snapshot_market_value ?? p.market_value;
      if (typeof px !== 'number' || px <= 0) return null;
      if (typeof mv !== 'number') return null;
      const t = normTick(p.ticker);
      const beta = betaOverride ?? (t ? betaMap[t] ?? DEFAULT_BETA_UNKNOWN : 1.0);
      return {
        nm: p.description || t || 'N/A',
        ccy: (p.currency || 'EUR').toUpperCase(),
        px,
        q: p.quantity,
        eur: mv,
        beta,
        tick: t,
      };
    };

    const out: StressEquity[] = [];
    [...stocks, ...etfs].forEach((p) => {
      const e = buildFromPosition(p);
      if (e) out.push(e);
    });
    // Commodity: opzionale, ma se inclusa nel patrimonio entra qui con beta default 0
    if (inputs.includeCommodity) {
      commodities.forEach((p) => {
        // L'oro fisico hedged ha beta ~0; lo stesso per le materie prime non agganciate all'equity
        const e = buildFromPosition(p, 0);
        if (e) out.push(e);
      });
    }
    // GP nel shock: solo se richiesto (solo azioni — bond non si muovono con equity shock)
    if (inputs.includeGPInShock) {
      (gpHoldings || [])
        .filter((h) => h.asset_type === 'stock')
        .forEach((h) => {
          const t = normTick(h.ticker_code);
          const px = h.price;
          if (typeof px !== 'number' || px <= 0) return;
          out.push({
            nm: h.description || t || 'GP',
            ccy: (h.currency || 'EUR').toUpperCase(),
            px,
            q: h.quantity,
            eur: h.market_value ?? 0,
            beta: t ? betaMap[t] ?? DEFAULT_BETA_UNKNOWN : 1.0,
            tick: t,
          });
        });
    }
    return out;
  }, [stocks, etfs, commodities, gpHoldings, betaMap, inputs.includeCommodity, inputs.includeGPInShock]);

  /* ---------- 11. Patrimonio MTM (con toggle applicati) ---------- */

  const { ptfBaseMTM, patrimonyBreakdown } = useMemo(() => {
    const derivativesEUR = derivatives.reduce(
      (a, p) => a + (p.snapshot_market_value ?? p.market_value ?? 0),
      0,
    );
    const stocksEUR = stocks.reduce(
      (a, p) => a + (p.snapshot_market_value ?? p.market_value ?? 0),
      0,
    );
    const etfEUR = etfs.reduce(
      (a, p) => a + (p.snapshot_market_value ?? p.market_value ?? 0),
      0,
    );
    const bondsEUR = bonds.reduce(
      (a, p) => a + (p.snapshot_market_value ?? p.market_value ?? 0),
      0,
    );
    const commodityEUR = commodities.reduce(
      (a, p) => a + (p.snapshot_market_value ?? p.market_value ?? 0),
      0,
    );
    const cashEUR = portfolio?.cash_value ?? 0;

    let gpEUR = 0;
    if (inputs.includeGPInPatrimony) {
      gpEUR = (gpHoldings || []).reduce((a, h) => a + (h.market_value ?? 0), 0);
    }

    let total = derivativesEUR + stocksEUR + etfEUR;
    if (inputs.includeBonds) total += bondsEUR;
    if (inputs.includeCash) total += cashEUR;
    if (inputs.includeCommodity) total += commodityEUR;
    if (inputs.includeGPInPatrimony) total += gpEUR;

    return {
      ptfBaseMTM: total,
      patrimonyBreakdown: {
        derivativesEUR,
        stocksEUR,
        etfEUR,
        bondsEUR,
        commodityEUR,
        cashEUR,
        gpEUR,
      },
    };
  }, [
    derivatives,
    stocks,
    etfs,
    bonds,
    commodities,
    gpHoldings,
    portfolio?.cash_value,
    inputs.includeBonds,
    inputs.includeCash,
    inputs.includeCommodity,
    inputs.includeGPInPatrimony,
  ]);

  /* ---------- 12. Warning counters ---------- */

  const ivWarnings = useMemo(() => legs.filter((l) => l.fl).length, [legs]);

  /* ---------- 13. Output ---------- */

  return {
    legs,
    eq,
    unders: baselineUnders,
    fx,
    effIV,
    ptfBaseMTM,
    riskFree,
    ivWarnings,
    missingBetaTickers,
    isLoading: isLoadingPortfolio || isLoadingPrices || betasQuery.isLoading,
    isFetchingBeta: fetchedBetasQuery.isFetching || isFetchingMissing,
    baselineUnders,
    patrimonyBreakdown,
  };
}
