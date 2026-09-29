/**
 * Scadenza media del portafoglio derivati (Stress Lab).
 *
 * Media delle scadenze delle opzioni VENDUTE, pesata per il NOZIONALE di ogni gamba
 * (|contratti| × moltiplicatore × strike): una put venduta su 100 contratti a strike 500
 * pesa più di 1 contratto a strike 20. Call vendute e put vendute sono tenute separate.
 *
 * Con il rolling in discesa attivo, la parte rollata di una put è sostituita dalla put
 * DI ARRIVO (strike/scadenza a fine percorso): la media "dopo i roll" misura quanto il
 * rolling allunga la duration del book di put vendute. Tutte le scadenze sono misurate
 * da OGGI, così prima/dopo sono confrontabili.
 *
 * Modulo puro: nessuna dipendenza da React/DB.
 */
import type { StressLeg, LegResult } from './stressLab';
import { getOptionExpirationDateISO } from './optionExpiry';

/** Giorni per anno usati da yearsToExpiry (T delle gambe). */
export const DAYS_PER_YEAR = 365.25;

export interface AvgExpiry {
  /** Scadenza media pesata (giorni da oggi); null se nessuna gamba */
  days: number | null;
  /** Σ nozionale (valuta nativa delle opzioni, tipicamente USD) */
  notional: number;
  /** Σ |contratti| */
  contracts: number;
  /** Numero di gambe (o porzioni di gamba) che concorrono */
  legs: number;
}

interface Piece {
  T: number;
  K: number;
  q: number;
  mult: number;
}

/** Media delle scadenze (giorni) pesata per nozionale |q|·mult·K. */
export function weightedAvgExpiry(pieces: Piece[]): AvgExpiry {
  let w = 0;
  let wt = 0;
  let contracts = 0;
  let n = 0;
  for (const p of pieces) {
    const qa = Math.abs(p.q);
    if (!(qa > 0) || !(p.K > 0) || !(p.mult > 0) || !Number.isFinite(p.T)) continue;
    const wi = qa * p.mult * p.K;
    w += wi;
    wt += wi * Math.max(0, p.T);
    contracts += qa;
    n += 1;
  }
  return { days: w > 0 ? (wt / w) * DAYS_PER_YEAR : null, notional: w, contracts, legs: n };
}

export interface ShortExpirySummary {
  /** Call vendute (non toccate dal rolling) */
  calls: AvgExpiry;
  /** Put vendute allo stato attuale */
  puts: AvgExpiry;
  /** Put vendute dopo i roll dello scenario (= puts se nessun roll) */
  putsAfter: AvgExpiry;
  /** Sotto-insieme idoneo al rolling (contratti rollQ): prima / dopo */
  eligible: AvgExpiry;
  eligibleAfter: AvgExpiry;
  /** Gambe effettivamente rollate nello scenario */
  rolledLegs: number;
  /**
   * Solo le put EFFETTIVAMENTE rollate nello scenario (contratti rollati): scadenza media
   * delle put di partenza e delle put di arrivo (strike/nozionale di arrivo).
   */
  rolled: AvgExpiry;
  rolledAfter: AvgExpiry;
}

/**
 * Riepilogo scadenze medie di call e put vendute. `rows` = righe di runScenario (con
 * eventuali roll); se null/assenti, "dopo" coincide con "prima".
 */
export function shortExpirySummary(legs: StressLeg[], rows?: LegResult[] | null): ShortExpirySummary {
  const calls: Piece[] = [];
  const puts: Piece[] = [];
  const putsAfter: Piece[] = [];
  const elig: Piece[] = [];
  const eligAfter: Piece[] = [];
  const rolledBefore: Piece[] = [];
  const rolledAfter: Piece[] = [];
  const byIdx = new Map<number, LegResult>();
  (rows ?? []).forEach((r) => byIdx.set(r.i, r));
  let rolledLegs = 0;

  legs.forEach((l, i) => {
    if (!(l.q < 0)) return;
    const base: Piece = { T: l.T, K: l.K, q: l.q, mult: l.mult };
    if (l.cp === 'C') {
      calls.push(base);
      return;
    }
    puts.push(base);
    const rq = Math.max(l.q, Math.min(0, l.rollQ ?? 0)); // q ≤ rq ≤ 0
    if (rq < 0) elig.push({ ...base, q: rq });
    const row = byIdx.get(i);
    const rolled =
      row && row.rolls && row.rolls.length > 0 && (row.rollQ ?? 0) < 0 && row.finalK != null && row.finalT != null;
    if (!rolled) {
      putsAfter.push(base);
      if (rq < 0) eligAfter.push({ ...base, q: rq });
      return;
    }
    rolledLegs += 1;
    const rqRow = Math.max(l.q, row!.rollQ as number);
    const qStatic = l.q - rqRow;
    if (qStatic < 0) putsAfter.push({ ...base, q: qStatic });
    const arrival: Piece = { T: row!.finalT as number, K: row!.finalK as number, q: rqRow, mult: l.mult };
    putsAfter.push(arrival);
    eligAfter.push(arrival);
    rolledBefore.push({ ...base, q: rqRow });
    rolledAfter.push(arrival);
  });

  return {
    calls: weightedAvgExpiry(calls),
    puts: weightedAvgExpiry(puts),
    putsAfter: weightedAvgExpiry(putsAfter),
    eligible: weightedAvgExpiry(elig),
    eligibleAfter: weightedAvgExpiry(eligAfter),
    rolledLegs,
    rolled: weightedAvgExpiry(rolledBefore),
    rolledAfter: weightedAvgExpiry(rolledAfter),
  };
}

/**
 * Data di scadenza (YYYY-MM-DD) della put di arrivo: il roll sposta la scadenza di mesi
 * interi (T + m/12), quindi si parte dalla scadenza originale e si aggiungono i mesi,
 * prendendo la scadenza mensile standard (terzo venerdì, holiday-adjusted).
 */
export function rolledExpiryISO(exp: string, fromT: number, toT: number): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(exp);
  if (!m) return null;
  const months = Math.round((toT - fromT) * 12);
  const total = parseInt(m[1], 10) * 12 + (parseInt(m[2], 10) - 1) + months;
  return getOptionExpirationDateISO(Math.floor(total / 12), total % 12);
}
