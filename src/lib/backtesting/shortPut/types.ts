/**
 * Tipi per la strategia di backtesting "Short Put mensile su paniere".
 *
 * Regole confermate:
 * 1. Vendita PUT OTM su scadenza mensile (terzo venerdì), scelta strike per
 *    distanza % dal prezzo, premio % sul nozionale (strike × contratti × 100),
 *    o entrambe.
 * 2. Ci si mantiene sulla scadenza mensile più vicina con almeno `minDte` DTE
 *    (default 10). Sotto `timeRollAtDte` DTE la posizione viene rollata sulla
 *    mensile successiva con i criteri di ingresso.
 * 3. Discesa: quando spot ≤ strike × (1 + soglia%), roll su strike più basso e
 *    scadenza mensile successiva più vicina possibile (cap 12 mesi), con premio
 *    netto ±tolleranza attorno al target % sul nuovo nozionale. Regola distinta
 *    per roll 1/2/3/4. Tra i candidati in tolleranza si sceglie lo strike più
 *    basso (più difensivo). Dopo il roll 4 si tiene fino a scadenza e si
 *    accetta l'assegnazione.
 * 4. Salita (trigger: distanza % spot-strike ≥ soglia):
 *    - se su prima scadenza: roll al rialzo con distanza minima % dal
 *      sottostante e premio netto ≥ x% sul nuovo nozionale;
 *    - se su scadenza successiva alla prima: rientro sulla prima scadenza con
 *      premio netto ±tolleranza attorno al target % sul nuovo nozionale e
 *      distanza minima % dal sottostante.
 * 5. Quantità contratti invariata a ogni roll; contratti fissi per titolo.
 */

export type ShortPutStrikeMode = 'distance' | 'premium' | 'both';
export type ShortPutFillModel = 'natural' | 'mid' | 'mid_with_slippage';

export interface ShortPutBasketItem {
  symbol: string;
  contracts: number;
}

export interface ShortPutRollRule {
  /** Premio netto target in % del nuovo nozionale (strike nuovo × contratti × 100). */
  netPremiumTargetPct: number;
  /** Tolleranza ± attorno al target, in punti percentuali. */
  netPremiumTolerancePct: number;
}

export interface ShortPutConfig {
  basket: ShortPutBasketItem[];
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  initialCapital: number;
  entry: {
    strikeMode: ShortPutStrikeMode;
    /** Distanza OTM minima: strike ≤ spot × (1 − distancePct/100). */
    distancePct: number;
    /** Premio target in % del nozionale. */
    premiumTargetPct: number;
    /** Tolleranza ± sul premio di ingresso, in punti percentuali. */
    premiumTolerancePct: number;
    /** DTE minimo della scadenza mensile scelta. */
    minDte: number;
  };
  maintenance: {
    /**
     * Sotto questo DTE, senza altri trigger, la posizione viene rollata sulla
     * mensile successiva con i criteri di ingresso (0 = tieni fino a scadenza).
     */
    timeRollAtDte: number;
  };
  downside: {
    /** Trigger: spot ≤ strike × (1 + triggerDistancePct/100). Soglia unica. */
    triggerDistancePct: number;
    /** Regole per roll 1..4, in ordine. */
    rolls: [ShortPutRollRule, ShortPutRollRule, ShortPutRollRule, ShortPutRollRule];
    /** Cap sulla distanza della nuova scadenza (mesi dalla data corrente). */
    maxMonthsForward: number;
  };
  upside: {
    /** Trigger: (spot − strike) / spot × 100 ≥ triggerDistancePct. */
    triggerDistancePct: number;
    /** Distanza minima del nuovo strike: strike ≤ spot × (1 − minDistancePct/100). */
    minDistancePct: number;
    /** Roll al rialzo su prima scadenza: premio netto ≥ questa % del nuovo nozionale. */
    minNetPremiumPct: number;
    /** Rientro da scadenze successive: premio netto target ± tolleranza. */
    recoveryNetPremiumTargetPct: number;
    recoveryNetPremiumTolerancePct: number;
  };
  execution: {
    fillModel: ShortPutFillModel;
    /** Quota dello half-spread applicata come slippage (solo mid_with_slippage). */
    slippagePctOfHalfSpread: number;
    commissionPerContract: number;
  };
}

export interface PutQuote {
  expiration: string; // YYYY-MM-DD
  strike: number;
  bid: number;
  ask: number;
}

/** Interfaccia dati: implementata dal provider sintetico ora, da ThetaData poi. */
export interface ShortPutMarketDataProvider {
  /** Giorni di negoziazione (ordinati) per il simbolo nell'intervallo. */
  getTradingDays(symbol: string, startDate: string, endDate: string): Promise<string[]>;
  /** Prezzo di chiusura del sottostante alla data. */
  getSpot(symbol: string, date: string): Promise<number>;
  /** Catena PUT (bid/ask EOD) per le scadenze richieste alla data di osservazione. */
  getPutChain(symbol: string, date: string, expirations: string[]): Promise<PutQuote[]>;
}

export type ShortPutEventType =
  | 'entry'
  | 'entry_skipped'
  | 'roll_down'
  | 'roll_down_failed'
  | 'roll_up'
  | 'roll_to_front'
  | 'time_roll'
  | 'max_rolls_reached'
  | 'expired_otm'
  | 'assignment';

export interface ShortPutEvent {
  date: string;
  symbol: string;
  type: ShortPutEventType;
  description: string;
  spot: number;
  /** Flusso di cassa netto dell'evento (premi ± chiusure, commissioni escluse). */
  cashFlow: number;
  commissions: number;
  rollCount?: number;
  from?: { strike: number; expiration: number | string };
  to?: { strike: number; expiration: string };
  /** Premio (netto per i roll) in % del nozionale di riferimento. */
  premiumPct?: number;
}

export interface ShortPutOpenPosition {
  symbol: string;
  contracts: number;
  strike: number;
  expiration: string;
  /** Numero di roll in discesa già eseguiti nel ciclo corrente. */
  rollCount: number;
  openDate: string;
}

export interface ShortPutEquityPoint {
  date: string;
  equity: number;
  cash: number;
}

export interface ShortPutSymbolSummary {
  symbol: string;
  contracts: number;
  grossPremiums: number;
  closeCosts: number;
  netPremiums: number;
  commissions: number;
  assignmentPL: number;
  realizedPL: number;
  entries: number;
  rollsDown: number;
  rollsUp: number;
  rollsToFront: number;
  timeRolls: number;
  assignments: number;
  expiredOtm: number;
}

export interface ShortPutBacktestResult {
  config: ShortPutConfig;
  equityCurve: ShortPutEquityPoint[];
  events: ShortPutEvent[];
  bySymbol: ShortPutSymbolSummary[];
  finalEquity: number;
  totalPL: number;
  totalPLPct: number;
  maxDrawdownPct: number;
  totalCommissions: number;
  totalNetPremiums: number;
  openPositions: ShortPutOpenPosition[];
  dataProviderLabel: string;
}

export const DEFAULT_SHORT_PUT_CONFIG: ShortPutConfig = {
  basket: [{ symbol: 'AAPL', contracts: 1 }],
  startDate: '2024-01-02',
  endDate: '2024-12-31',
  initialCapital: 100000,
  entry: {
    strikeMode: 'both',
    distancePct: 5,
    premiumTargetPct: 2,
    premiumTolerancePct: 0.75,
    minDte: 10,
  },
  maintenance: {
    timeRollAtDte: 10,
  },
  downside: {
    triggerDistancePct: 0,
    rolls: [
      { netPremiumTargetPct: 2, netPremiumTolerancePct: 1 },
      { netPremiumTargetPct: 2, netPremiumTolerancePct: 1 },
      { netPremiumTargetPct: 1.5, netPremiumTolerancePct: 1 },
      { netPremiumTargetPct: 1, netPremiumTolerancePct: 1 },
    ],
    maxMonthsForward: 12,
  },
  upside: {
    triggerDistancePct: 8,
    minDistancePct: 5,
    minNetPremiumPct: 0.5,
    recoveryNetPremiumTargetPct: 2,
    recoveryNetPremiumTolerancePct: 1,
  },
  execution: {
    fillModel: 'natural',
    slippagePctOfHalfSpread: 50,
    commissionPerContract: 1,
  },
};
