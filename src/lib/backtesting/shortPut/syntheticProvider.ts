/**
 * Provider dati sintetico (Black-Scholes) per validare il motore end-to-end
 * PRIMA di scaricare dati ThetaData. I prezzi sono dichiaratamente sintetici:
 * mai da presentare come storici. L'interfaccia è identica a quella che
 * implementerà l'adapter ThetaData.
 */
import { bsPrice } from '@/lib/blackScholes';
import { addCalendarDays, daysBetween, monthlyExpiriesFrom, parseDateUTC } from './expiryCalendar';
import { PutQuote, ShortPutMarketDataProvider } from './types';

export interface SyntheticSymbolParams {
  initialPrice: number;
  /** Volatilità implicita flat usata per il pricing delle opzioni. */
  impliedVol: number;
  /** Drift annuo del percorso simulato (es. 0.05 = +5%). */
  drift: number;
  /** Volatilità realizzata annua del percorso simulato. */
  realizedVol: number;
  /** Spread bid/ask in % del mid. */
  spreadPct: number;
  /** Seed deterministico per la riproducibilità. */
  seed: number;
}

export const DEFAULT_SYNTHETIC_PARAMS: SyntheticSymbolParams = {
  initialPrice: 100,
  impliedVol: 0.28,
  drift: 0.06,
  realizedVol: 0.24,
  spreadPct: 4,
  seed: 0,
};

const RISK_FREE = 0.04;

/** PRNG deterministico (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function isWeekend(date: string): boolean {
  const dow = parseDateUTC(date).getUTCDay();
  return dow === 0 || dow === 6;
}

function strikeStep(spot: number): number {
  if (spot < 25) return 0.5;
  if (spot < 100) return 1;
  if (spot < 250) return 2.5;
  return 5;
}

export type PricePathOverride = Map<string, number>; // date → close

export class SyntheticMarketDataProvider implements ShortPutMarketDataProvider {
  private paths = new Map<string, Map<string, number>>();
  private tradingDays = new Map<string, string[]>();

  constructor(
    private readonly params: Map<string, SyntheticSymbolParams>,
    private readonly startDate: string,
    private readonly endDate: string,
    private readonly overrides?: Map<string, PricePathOverride>,
  ) {}

  private ensurePath(symbol: string): void {
    if (this.paths.has(symbol)) return;
    const days: string[] = [];
    let cursor = this.startDate;
    // Il percorso si estende oltre endDate per poter prezzare le scadenze lontane.
    const horizon = addCalendarDays(this.endDate, 400);
    while (cursor <= horizon) {
      if (!isWeekend(cursor)) days.push(cursor);
      cursor = addCalendarDays(cursor, 1);
    }
    const override = this.overrides?.get(symbol);
    const path = new Map<string, number>();
    if (override) {
      for (const day of days) {
        const price = override.get(day);
        if (price != null) path.set(day, price);
      }
      this.tradingDays.set(symbol, days.filter((d) => path.has(d)));
    } else {
      const p = this.params.get(symbol);
      if (!p) throw new Error(`Parametri sintetici mancanti per ${symbol}`);
      const rng = mulberry32(p.seed || hashSymbol(symbol));
      const dt = 1 / 252;
      let price = p.initialPrice;
      for (const day of days) {
        path.set(day, price);
        const z = gaussian(rng);
        price = price * Math.exp((p.drift - 0.5 * p.realizedVol ** 2) * dt + p.realizedVol * Math.sqrt(dt) * z);
      }
      this.tradingDays.set(symbol, days);
    }
    this.paths.set(symbol, path);
  }

  async getTradingDays(symbol: string, startDate: string, endDate: string): Promise<string[]> {
    this.ensurePath(symbol);
    return (this.tradingDays.get(symbol) ?? []).filter((d) => d >= startDate && d <= endDate);
  }

  async getSpot(symbol: string, date: string): Promise<number> {
    this.ensurePath(symbol);
    const price = this.paths.get(symbol)?.get(date);
    if (price == null) throw new Error(`Prezzo sintetico mancante per ${symbol} @ ${date}`);
    return price;
  }

  async getPutChain(symbol: string, date: string, expirations: string[]): Promise<PutQuote[]> {
    this.ensurePath(symbol);
    const spot = await this.getSpot(symbol, date);
    const p = this.params.get(symbol) ?? { ...DEFAULT_SYNTHETIC_PARAMS, seed: hashSymbol(symbol) };
    const step = strikeStep(spot);
    const minStrike = Math.max(step, Math.floor((spot * 0.4) / step) * step);
    const maxStrike = Math.ceil((spot * 1.6) / step) * step;
    const quotes: PutQuote[] = [];
    for (const expiration of expirations) {
      const dte = daysBetween(date, expiration);
      if (dte <= 0) continue;
      const t = dte / 365;
      for (let strike = minStrike; strike <= maxStrike + 1e-9; strike += step) {
        const k = Number(strike.toFixed(2));
        const mid = bsPrice(spot, k, t, RISK_FREE, p.impliedVol, 'put');
        if (mid < 0.02) continue;
        const half = (mid * (p.spreadPct / 100)) / 2;
        quotes.push({
          expiration,
          strike: k,
          bid: Number(Math.max(0.01, mid - half).toFixed(2)),
          ask: Number((mid + half).toFixed(2)),
        });
      }
    }
    return quotes;
  }

  /** Scadenze disponibili coerenti con il calendario mensile. */
  static expirationsFor(date: string, maxMonthsForward: number): string[] {
    return monthlyExpiriesFrom(date, 0, maxMonthsForward);
  }
}

function hashSymbol(symbol: string): number {
  let h = 2166136261;
  for (const ch of symbol) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
