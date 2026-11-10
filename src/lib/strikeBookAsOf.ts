/**
 * Catene di strike put quotati ALLA DATA dello snapshot, per il rolling dello Stress Lab.
 *
 * Righe da RPC listed_strikes_as_of (storico versionato option_listed_strikes_history):
 * per ogni (ticker, scadenza > data) la versione quotata più recente entro la data, oppure
 * — se l'archivio non copre la data — la prima versione successiva (asOf > data, segnalata
 * in UI). Le scadenze oggi già passate restano incluse se vive alla data dello snapshot.
 */
import { StrikeBook, yearsToExpiry } from '@/lib/stressLab';

export interface ListedStrikesRow {
  ticker: string;
  expiry: string;
  put_strikes: (number | string)[] | null;
  /** Data di quotazione della versione (assente: tabella corrente non versionata). */
  as_of?: string | null;
}

export function buildStrikeBook(rows: ListedStrikesRow[], ref: Date): StrikeBook {
  const b: StrikeBook = {};
  for (const row of rows) {
    const ks = (row.put_strikes ?? []).map(Number).filter((k) => Number.isFinite(k) && k > 0);
    if (ks.length < 2) continue;
    const T = yearsToExpiry(row.expiry, ref);
    if (T <= 0) continue; // scaduta già alla data di riferimento
    const tk = row.ticker.toUpperCase();
    (b[tk] = b[tk] || []).push({ T, exp: row.expiry, strikes: ks, ...(row.as_of ? { asOf: row.as_of } : {}) });
  }
  for (const k of Object.keys(b)) b[k].sort((x, y) => x.T - y.T);
  return b;
}

/** Catena usata per la scadenza di arrivo di un roll (stessa tolleranza del motore: ±½ mese). */
export function chainForRoll(book: StrikeBook, u: string, toT: number) {
  const chains = book[u.toUpperCase()] ?? [];
  return chains
    .filter((c) => Math.abs(c.T - toT) <= 0.5 / 12)
    .sort((a, b) => Math.abs(a.T - toT) - Math.abs(b.T - toT))[0];
}
