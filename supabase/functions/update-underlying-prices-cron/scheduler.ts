/**
 * Helper puri di scheduling per `update-underlying-prices-cron`.
 *
 * Incidente del 2026-07-31: la funzione processava TUTTI i ticker US in un
 * unico invocazione, inserendo una pausa di 60 secondi tra un batch Finnhub e
 * il successivo. Con ~90 ticker US il run superava i 90 secondi e il gateway
 * Supabase rispondeva 504 (10 volte in 3 ore), lasciando i prezzi fermi.
 *
 * Il modello corretto: il job gira ogni 5 minuti, quindi ogni invocazione puo'
 * limitarsi alla quota di chiamate consentita in una finestra di rate limit
 * (60/min su Finnhub) scegliendo i ticker piu' "stantii". Nessuna attesa
 * artificiale: il ciclo completo si chiude in due o tre run consecutivi.
 *
 * Questo file non usa API Deno: e' importato sia dall'edge function sia dai
 * test vitest.
 */

/** Suffissi delle borse europee: questi ticker vengono letti da Yahoo. */
export const EU_SUFFIXES = [
  '.MI', '.DE', '.SW', '.PA', '.AS', '.L', '.MC',
  '.BR', '.VI', '.CO', '.HE', '.ST', '.OL', '.LS',
];

export function isEuropeanTicker(ticker: string): boolean {
  const upper = String(ticker || '').toUpperCase();
  return EU_SUFFIXES.some((suffix) => upper.endsWith(suffix));
}

/** Timestamp dell'ultimo aggiornamento noto, per ticker. */
export type LastUpdatedMap = Record<string, string | null | undefined>;

function toEpoch(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Ordina i ticker dal piu' stantio al piu' fresco (mai aggiornati per primi) e
 * ne restituisce al massimo `quota`. L'ordinamento e' deterministico: a parita'
 * di timestamp vince l'ordine alfabetico, cosi' run consecutivi con la stessa
 * fotografia del database non ripescano sempre gli stessi ticker per caso.
 *
 * `quota <= 0` o non finita significa "nessun limite".
 */
export function selectStaleFirst(
  tickers: string[],
  lastUpdated: LastUpdatedMap,
  quota: number,
): string[] {
  const unique = [...new Set((tickers || []).filter((t): t is string => !!t))];

  unique.sort((a, b) => {
    const diff = toEpoch(lastUpdated[a]) - toEpoch(lastUpdated[b]);
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  });

  if (!Number.isFinite(quota) || quota <= 0) return unique;
  return unique.slice(0, Math.floor(quota));
}

/** Millisecondi rimasti prima della scadenza del budget di esecuzione. */
export function remainingBudgetMs(startedAt: number, budgetMs: number, now: number): number {
  return Math.max(0, startedAt + budgetMs - now);
}

/**
 * True finche' c'e' margine per un'altra richiesta di rete. `reserveMs` e' il
 * tempo che vogliamo lasciare libero per scrivere i risultati gia' raccolti e
 * rispondere: senza questa riserva un run al limite verrebbe troncato dal
 * gateway e i prezzi appena letti andrebbero persi.
 */
export function hasBudgetLeft(
  startedAt: number,
  budgetMs: number,
  now: number,
  reserveMs = 5000,
): boolean {
  return remainingBudgetMs(startedAt, budgetMs, now) > reserveMs;
}

/**
 * Esegue `worker` sugli item con un pool a concorrenza limitata, fermandosi
 * appena `shouldContinue` diventa falso. Restituisce i risultati raccolti e gli
 * item non processati (utili per loggare la copertura parziale).
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
  shouldContinue: () => boolean = () => true,
): Promise<{ results: R[]; skipped: T[] }> {
  const results: R[] = [];
  const pool = Math.max(1, Math.floor(concurrency));
  let cursor = 0;
  let stopped = false;

  async function runner(): Promise<void> {
    while (true) {
      if (stopped || !shouldContinue()) {
        stopped = true;
        return;
      }
      const index = cursor++;
      if (index >= items.length) return;
      results.push(await worker(items[index]));
    }
  }

  await Promise.all(Array.from({ length: Math.min(pool, items.length) }, () => runner()));

  const processed = Math.min(cursor, items.length);
  return { results, skipped: stopped ? items.slice(processed) : [] };
}
