/**
 * Risoluzione nome sottostante → ticker tramite la tabella `underlying_mappings`.
 *
 * Logica unica condivisa da Stress Lab (useStressLab) e Portafoglio virtuale (universo
 * strumenti dei clienti): stesso input → stesso ticker, così una put simulata su "NVDA" e
 * le put reali su "NVIDIA CORP" finiscono sotto la stessa chiave.
 */

/**
 * Normalizzazione canonica per il confronto degli underlying con i mapping in DB.
 * Rimuove punteggiatura, spazi, suffissi societari (INC/CORP/LTD/LLC/PLC/CO/THE)
 * e ogni carattere non alfanumerico. Da usare ovunque si confronti un underlying
 * con la tabella `underlying_mappings`.
 */
export const normalizeUnderlying = (s: string): string =>
  s.toUpperCase()
    .replace(/[.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(INC|CORP|LTD|LLC|PLC|CO|THE)\b/g, '')
    .replace(/[^A-Z0-9]/g, '');

/** Ticker pulito (es. AAPL, GOOGL, ENI.MI, ^TNX) — no spazi/virgole/parentesi */
export const VALID_TICKER_RE = /^[A-Z0-9.\-^=]{1,12}$/;

export interface UnderlyingMappingRow {
  underlying: string;
  ticker: string;
}

/**
 * Nome sottostante → ticker. PRIORITÀ AI MAPPINGS (anche se "RAMBUS" passa VALID_TICKER_RE,
 * il mapping RAMBUS→RMBS vince): match esatto, poi normalizzato; fallback: il nome stesso se
 * è un ticker formalmente valido. '' se nulla risolve.
 */
export function resolveUnderlyingTickerFromMappings(
  raw: string | null | undefined,
  mappings: UnderlyingMappingRow[] | null | undefined,
): string {
  if (!raw) return '';
  const up = String(raw).toUpperCase().trim();
  if (mappings && mappings.length) {
    const direct =
      mappings.find((m) => String(m.underlying).toUpperCase() === up) ||
      mappings.find((m) => m.underlying === raw);
    if (direct) return String(direct.ticker).toUpperCase();
    const normKey = normalizeUnderlying(String(raw));
    const norm = mappings.find((m) => normalizeUnderlying(String(m.underlying)) === normKey);
    if (norm) return String(norm.ticker).toUpperCase();
  }
  if (VALID_TICKER_RE.test(up)) return up;
  return '';
}
