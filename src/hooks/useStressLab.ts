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
import { useUnderlyingPrices, UnderlyingPrice } from '@/hooks/useUnderlyingPrices';
import { useGPHoldings, GPHoldingRow } from '@/hooks/useGPHoldings';
import { resolveUnderlyingIdentity, buildDynamicAliasMap, normalizeText } from '@/lib/tickerIdentity';
import { useHistoricalData } from '@/hooks/useHistoricalData';
import { useRiskAnalysis } from '@/hooks/useRiskAnalysis';
import { useDerivativeOverrides } from '@/hooks/useDerivativeOverrides';
import { useStrategyConfigurations } from '@/hooks/useStrategyConfigurations';
import { useDerivativeNetting } from '@/hooks/useDerivativeNetting';
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
  /** Ambito del patrimonio di riferimento (denominatore di P&L% e beta, e valore mostrato):
   *  'total'  = patrimonio totale = netting completo (equity+etf+bond+cash+oro+derivati
   *             nettati) + Gestione Patrimoniale (cassa+azioni+bond GP). = netting dashboard.
   *  'equity' = Solo Equity = esposizione equity del Risk Analyzer (tutti i toggle ON =
   *             analysis.grandTotal). Col sotto-toggle gpEquity si aggiungono le azioni GP. */
  patrimonyScope: 'total' | 'equity';
  /** Solo per 'equity': include l'esposizione azionaria della Gestione Patrimoniale
   *  (equivale al toggle GP del Risk Analyzer). Ignorato in 'total' (la GP è già inclusa). */
  gpEquity: boolean;
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
  /** Patrimonio MTM totale (EUR): book a market value (derivati inclusi a MTM pieno) + GP.
   *  Denominatore dell'incidenza margine; indipendente dall'ambito. */
  ptfBaseMTM: number;
  /** Patrimonio = NETTING TOTALE (stessa metrica della dashboard), coi toggle applicati */
  nettingTotal: number;
  /** Patrimonio = NETTING EX CC E NP (stessa metrica della dashboard), coi toggle applicati */
  nettingExCCAndNP: number;
  /** Netting GREZZO (ambito 'total', senza ritaglio), per etichettare le opzioni di ambito */
  nettingTotalRaw: number;
  nettingExCCAndNPRaw: number;
  /** Esposizione equity del Risk Analyzer (analysis.grandTotal, tutti i toggle ON, GP esclusa).
   *  Base della card "Solo Equity"; +gpEquityEUR quando il sotto-toggle GP è attivo. */
  equityExposureNoGP: number;
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
    gpTotalEUR: number;
    gpEquityEUR: number;
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
  const { positions, portfolio, summary, isLoading: isLoadingPortfolio } = usePortfolio();
  const { gpHoldings, gpSummary } = useGPHoldings();
  // Esposizione equity del Risk Analyzer: grandTotal = tutti i toggle ON, GP esclusa.
  const riskAnalysis = useRiskAnalysis();
  const { overrides } = useDerivativeOverrides();
  const { configurations: strategyConfigs } = useStrategyConfigurations();

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

  // Alias dinamici per risolvere i nomi GP: mappings backend + descrizioni dei titoli del
  // DEPOSITO (così resolveUnderlyingIdentity fa match esatto E per sottosequenza di token,
  // robusto a piccole differenze tipo "SPA"/"INC"/"ORD" nella descrizione).
  const gpDynamicAliases = useMemo(() => {
    const bookRows = [...stocks, ...etfs]
      .filter((p) => p.ticker && /[A-Za-z]/.test(p.ticker))
      .map((p) => ({ underlying: p.description, ticker: normTick(p.ticker) }));
    const mapRows = mappingsQuery.data?.mappings ?? [];
    return buildDynamicAliasMap([...bookRows, ...mapRows]);
  }, [stocks, etfs, mappingsQuery.data]);

  // Indice descrizione→ticker dai titoli del DEPOSITO (book): è il match più affidabile per
  // raggruppare lo stesso strumento detenuto sia in GP sia in deposito (la GP non ha ISIN).
  const bookTickerByName = useMemo(() => {
    const m = new Map<string, string>();
    [...stocks, ...etfs].forEach((p) => {
      const tk = normTick(p.ticker);
      if (!tk || !/[A-Z]/.test(tk)) return;
      const nd = normalizeText(p.description);
      if (nd && !m.has(nd)) m.set(nd, tk);
    });
    return m;
  }, [stocks, etfs]);

  // Risolve il TICKER CANONICO di un'azione GP, così lo stesso strumento detenuto in GP e in
  // deposito finisce sotto la stessa chiave (si raggruppa) e mostra SEMPRE il ticker. Catena:
  //   1) descrizione matchata coi titoli del deposito → ticker del deposito (raggruppa)
  //   2) ticker_code se è già un ticker alfabetico (via mappings)
  //   3) descrizione via mappings backend
  //   4) alias canonici (statici + dinamici)
  // Se NIENTE risolve, ritorna '' (MAI il codice numerico): a valle si userà la descrizione.
  const resolveGpTicker = useCallback(
    (h: GPHoldingRow): string => {
      const nd = normalizeText(h.description);
      const fromBook = nd ? bookTickerByName.get(nd) : undefined;
      if (fromBook) return fromBook;

      const tc = normTick(h.ticker_code);
      if (tc && /[A-Z]/.test(tc)) {
        const viaMap = resolveUnderlying(tc);
        return viaMap && /[A-Z]/.test(viaMap) ? viaMap : tc;
      }

      const viaDesc = resolveUnderlying(h.description);
      if (viaDesc && /[A-Z]/.test(viaDesc)) return viaDesc;

      const id = resolveUnderlyingIdentity(
        { rawTicker: h.ticker_code, description: h.description },
        { dynamicAliases: gpDynamicAliases },
      );
      if (id.displayTicker && /[A-Z]/.test(id.displayTicker)) return normTick(id.displayTicker);

      return '';
    },
    [resolveUnderlying, gpDynamicAliases, bookTickerByName],
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
    const missing = allTickers.filter((t) => !have.has(t));

    // Diagnostica mirata: per ogni ticker mancante mostra nome grezzo dell'opzione,
    // ticker risolto, e cosa ha restituito ticker_fundamentals. Aiuta a distinguere
    // "mapping mancante" da "riga presente ma beta NULL" da "ticker scritto diverso".
    if (missing.length > 0) {
      const rowsByTicker = new Map(
        (betasQuery.data || []).map((r) => [normTick(r.ticker), r]),
      );
      const detail = missing.map((t) => {
        const rawNames = derivatives
          .filter((d) => getOptionUnderlyingKey(d) === t)
          .map((d) => d.underlying || d.description);
        const row = rowsByTicker.get(t);
        return {
          ticker: t,
          rawUnderlyingNames: [...new Set(rawNames)],
          dbRowFound: !!row,
          dbBeta: row ? row.beta : '(nessuna riga)',
        };
      });
      console.log('[StressLab] Beta mancanti — dettaglio risoluzione:', detail);
    }

    return missing;
  }, [betasQuery.data, allTickers, derivatives, getOptionUnderlyingKey]);

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

    // a) PRIMA lo spot FROZEN dalle posizioni stock/etf/commodity (snapshot_price).
    //    È stabile (non cambia navigando) e COERENTE con i premi snapshot usati per
    //    le gambe: così l'IV = impliedVol(premio_snapshot, spot_snapshot) è
    //    deterministica. Usare lo spot LIVE (underlyingPrices) qui mischiava premio
    //    frozen + spot live → IV instabile e numeri diversi tra una visita e l'altra
    //    (il layer prezzi live viene mutato in memoria dalla dashboard).
    [...stocks, ...etfs, ...commodities].forEach((s) => {
      const t = normTick(s.ticker);
      if (!t) return;
      const px = s.snapshot_price ?? s.current_price;
      if (typeof px === 'number' && px > 0 && !m[t]) {
        m[t] = { S: px, beta: betaMap[t] ?? DEFAULT_BETA_UNKNOWN };
      }
    });

    // b) POI, SOLO per i sottostanti delle opzioni che NON sono detenuti come titolo
    //    (nessuno snapshot disponibile), lo spot arriva dal price layer: è l'unica
    //    fonte per quei nomi.
    derivatives.forEach((d) => {
      const key = getOptionUnderlyingKey(d);
      if (!key || m[key]) return;
      const lookupName = d.underlying || d.description;
      const cached = lookupName ? underlyingPrices[lookupName] : undefined;
      const spot = cached?.price;
      if (spot && spot > 0) {
        m[key] = { S: spot, beta: betaMap[key] ?? DEFAULT_BETA_UNKNOWN };
      }
    });

    // b2) Azioni della GP: entrano nello shock negli ambiti che le contano nel patrimonio,
    //     cioè 'total' (GP sempre inclusa) e 'equity' con sotto-toggle gpEquity ON. Vanno in
    //     mappa così runScenario usa il beta da unders (mercato) e il remap beta=1 della
    //     modalità "titoli" le raggiunge. Guardia !m[t]: non sovrascrive mai book/opzioni.
    if (inputs.patrimonyScope === 'total' || inputs.gpEquity) {
      (gpHoldings || [])
        .filter((h) => h.asset_type === 'stock')
        .forEach((h) => {
          const t = resolveGpTicker(h);
          const px = h.price;
          if (!t || m[t]) return;
          if (typeof px === 'number' && px > 0) {
            m[t] = { S: px, beta: betaMap[t] ?? DEFAULT_BETA_UNKNOWN };
          }
        });
    }

    // c) EUR/USD: lo "spot" è quante USD per 1 EUR = fx.USD
    m['EURUSD'] = { S: fx.USD, beta: 0 };

    return m;
  }, [derivatives, stocks, etfs, commodities, gpHoldings, inputs.patrimonyScope, inputs.gpEquity, underlyingPrices, betaMap, fx.USD, getOptionUnderlyingKey, resolveGpTicker]);

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
    // GP: l'esposizione equity della Gestione Patrimoniale entra nello shock dello scenario
    // negli ambiti che la contano nel patrimonio: 'total' (sempre) e 'equity' con gpEquity ON.
    // Solo le azioni; le obbligazioni GP restano fuori dallo shock.
    if (inputs.patrimonyScope === 'total' || inputs.gpEquity) {
      (gpHoldings || [])
        .filter((h) => h.asset_type === 'stock')
        .forEach((h) => {
          const t = resolveGpTicker(h);
          const px = h.price;
          if (typeof px !== 'number' || px <= 0) return;
          out.push({
            nm: t || h.description || 'GP',
            ccy: (h.currency || 'EUR').toUpperCase(),
            px,
            q: h.quantity,
            eur: h.market_value ?? 0,
            beta: t ? betaMap[t] ?? DEFAULT_BETA_UNKNOWN : 1.0,
            tick: t,
            gp: true,
          });
        });
    }
    return out;
  }, [stocks, etfs, gpHoldings, betaMap, inputs.patrimonyScope, inputs.gpEquity, resolveGpTicker]);

  /* ---------- 11. Patrimonio MTM (totale, per il rapporto di margine) ---------- */

  const { ptfBaseMTM, patrimonyBreakdown } = useMemo(() => {
    const sum = (arr: Position[]) =>
      arr.reduce((a, p) => a + (p.snapshot_market_value ?? p.market_value ?? 0), 0);
    const derivativesEUR = sum(derivatives);
    const stocksEUR = sum(stocks);
    const etfEUR = sum(etfs);
    const bondsEUR = sum(bonds);
    const commodityEUR = sum(commodities);
    const cashEUR = portfolio?.cash_value ?? 0;
    const gpEUR = (gpHoldings || []).reduce((a, h) => a + (h.market_value ?? 0), 0);
    // GP "totale" come la dashboard: SOLO cash+stock+bond (gpSummary.totalValue), non
    // altri asset_type. È esattamente la quota che la dashboard fonde in summary.totalValue.
    const gpTotalEUR = gpSummary.totalValue;
    const gpEquityEUR = (gpHoldings || [])
      .filter((h) => h.asset_type === 'stock')
      .reduce((a, h) => a + (h.market_value ?? 0), 0);

    // Patrimonio MTM TOTALE (sempre completo): denominatore del rapporto di margine.
    // Include la GP (gpTotalEUR) come ogni altra metrica di patrimonio totale.
    const total =
      derivativesEUR + stocksEUR + etfEUR + bondsEUR + cashEUR + commodityEUR + gpTotalEUR;

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
        gpTotalEUR,
        gpEquityEUR,
      },
    };
  }, [derivatives, stocks, etfs, bonds, commodities, gpHoldings, gpSummary.totalValue, portfolio?.cash_value]);

  /* ---------- 12. Warning counters ---------- */

  const ivWarnings = useMemo(() => legs.filter((l) => l.fl).length, [legs]);

  /* ---------- 12b. NETTING (stessa metrica e stesso motore della dashboard) ----------
   * useDerivativeNetting parte da summary.totalValue (azioni+etf+bond+cash+commodity) e vi
   * somma il contributo nettato dei derivati. Per essere BYTE-IDENTICI alla dashboard:
   *   1) summary fuso con la GP (summary.totalValue += gpSummary.totalValue), come fa
   *      Dashboard.tsx — altrimenti il "Patrimonio Totale" del simulatore esclude la GP;
   *   2) netting su PREZZI CONGELATI dello snapshot (snapshot_underlying_prices), non sui
   *      prezzi live: gli stessi che usa la dashboard, così il contributo intrinseco di
   *      covered call / naked put orfane coincide e non si muove al remount (cfr. §10).
   * L'AMBITO (patrimonyScope) decide il base:
   *  - 'total'  → netting completo CON GP (= netting totale della dashboard)
   *  - 'equity' → esposizione equity del Risk Analyzer (analysis.grandTotal, tutti i toggle
   *               ON), + azioni GP se il sotto-toggle gpEquity è ON. NON dipende dal netting.
   */
  const nettingPositions = useMemo(() => positions || [], [positions]);
  const nettingOverrides = useMemo(() => overrides || [], [overrides]);
  const nettingConfigs = useMemo(() => strategyConfigs || [], [strategyConfigs]);

  // (1) summary con GP fusa — identico a Dashboard.tsx (solo totalValue serve al netting)
  const summaryWithGP = useMemo(() => {
    if (!summary) return summary;
    if (gpSummary.totalValue === 0) return summary;
    return { ...summary, totalValue: summary.totalValue + gpSummary.totalValue };
  }, [summary, gpSummary.totalValue]);

  // (2) prezzi congelati dello snapshot corrente — identico a Dashboard.tsx
  const { historicalData } = useHistoricalData(portfolio?.id);
  const frozenUnderlyingPrices = useMemo(() => {
    const currentDate = portfolio?.snapshot_date;
    const currentEntry = currentDate
      ? historicalData.find((h) => h.snapshot_date === currentDate)
      : null;
    const frozenRaw = (currentEntry?.snapshot_underlying_prices ?? {}) as Record<string, number>;
    const merged: Record<string, UnderlyingPrice> = {};
    for (const [k, v] of Object.entries(underlyingPrices)) merged[k] = v;
    for (const [k, px] of Object.entries(frozenRaw)) {
      if (typeof px === 'number' && px > 0) merged[k] = { price: px, currency: 'USD' };
    }
    return merged;
  }, [portfolio?.snapshot_date, historicalData, underlyingPrices]);

  const liveNetting = useDerivativeNetting(
    nettingPositions,
    summaryWithGP,
    nettingOverrides,
    frozenUnderlyingPrices,
    false,
    nettingConfigs,
  );

  // Solo Equity = esposizione equity del Risk Analyzer con tutti i toggle ON (= grandTotal).
  const equityExposureNoGP = riskAnalysis.grandTotal ?? 0;

  const { nettingTotal, nettingExCCAndNP } = useMemo(() => {
    if (inputs.patrimonyScope === 'equity') {
      // base = esposizione equity RA (+ azioni GP se gpEquity ON). Indipendente dal netting.
      const base = equityExposureNoGP + (inputs.gpEquity ? patrimonyBreakdown.gpEquityEUR : 0);
      return { nettingTotal: base, nettingExCCAndNP: base };
    }
    // 'total': netting completo con GP (come la dashboard).
    return {
      nettingTotal: liveNetting.nettingTotal,
      nettingExCCAndNP: liveNetting.nettingExCCAndNP,
    };
  }, [
    liveNetting.nettingTotal,
    liveNetting.nettingExCCAndNP,
    inputs.patrimonyScope,
    inputs.gpEquity,
    equityExposureNoGP,
    patrimonyBreakdown,
  ]);

  /* ---------- 13. Output ---------- */

  return {
    legs,
    eq,
    unders: baselineUnders,
    fx,
    effIV,
    ptfBaseMTM,
    nettingTotal,
    nettingExCCAndNP,
    nettingTotalRaw: liveNetting.nettingTotal,
    nettingExCCAndNPRaw: liveNetting.nettingExCCAndNP,
    equityExposureNoGP,
    riskFree,
    ivWarnings,
    missingBetaTickers,
    isLoading: isLoadingPortfolio || isLoadingPrices || betasQuery.isLoading,
    isFetchingBeta: fetchedBetasQuery.isFetching || isFetchingMissing,
    baselineUnders,
    patrimonyBreakdown,
  };
}
