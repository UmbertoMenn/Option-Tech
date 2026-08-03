import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  hasBudgetLeft,
  isEuropeanTicker,
  remainingBudgetMs,
  runWithConcurrency,
  selectStaleFirst,
} from '../../supabase/functions/update-underlying-prices-cron/scheduler.ts';

/**
 * Regressione: incidente del 2026-07-31.
 *
 * `update-underlying-prices-cron` processava tutti i ticker US in una sola
 * invocazione, con `await delay(60000)` tra un batch Finnhub e il successivo.
 * Con ~90 ticker US il run superava i 90 secondi: il gateway ha risposto 504
 * dieci volte in tre ore (piu' un 502) e i prezzi sono rimasti fermi.
 *
 * Il job gira ogni 5 minuti, quindi ogni run deve limitarsi alla quota di una
 * finestra di rate limit e ripartire dai ticker piu' stantii.
 */

const CRON_INDEX = path.resolve(
  __dirname,
  '../../supabase/functions/update-underlying-prices-cron/index.ts',
);

function readCronSource(): string {
  return readFileSync(CRON_INDEX, 'utf8');
}

describe('selectStaleFirst', () => {
  it('prova del bug: senza quota tutti i ticker finiscono in un unico run', () => {
    const tickers = Array.from({ length: 90 }, (_, i) => `T${String(i).padStart(2, '0')}`);
    expect(selectStaleFirst(tickers, {}, 0)).toHaveLength(90);
    // Con la quota, il run resta entro la finestra di rate limit.
    expect(selectStaleFirst(tickers, {}, 60)).toHaveLength(60);
  });

  it('mette per primi i ticker mai aggiornati', () => {
    const result = selectStaleFirst(['AAPL', 'MSFT', 'NVDA'], {
      AAPL: '2026-07-31T10:00:00Z',
      MSFT: null,
      NVDA: '2026-07-31T09:00:00Z',
    }, 2);

    expect(result).toEqual(['MSFT', 'NVDA']);
  });

  it("ordina dal piu' stantio al piu' fresco", () => {
    const result = selectStaleFirst(['A', 'B', 'C'], {
      A: '2026-07-31T12:00:00Z',
      B: '2026-07-31T08:00:00Z',
      C: '2026-07-31T10:00:00Z',
    }, 10);

    expect(result).toEqual(['B', 'C', 'A']);
  });

  it('copre tutti i ticker in run consecutivi (nessuno resta indietro)', () => {
    const tickers = Array.from({ length: 90 }, (_, i) => `T${String(i).padStart(2, '0')}`);
    const lastUpdated: Record<string, string> = {};

    const covered = new Set<string>();
    let clock = Date.parse('2026-08-03T09:00:00Z');

    for (let run = 0; run < 2; run++) {
      const selected = selectStaleFirst(tickers, lastUpdated, 60);
      selected.forEach((t) => {
        covered.add(t);
        lastUpdated[t] = new Date(clock).toISOString();
      });
      clock += 5 * 60_000;
    }

    expect(covered.size).toBe(90);
  });

  it('deduplica e ignora valori vuoti', () => {
    expect(selectStaleFirst(['AAPL', 'AAPL', '', null as unknown as string], {}, 10)).toEqual(['AAPL']);
  });

  it("a parita' di timestamp usa un ordine deterministico", () => {
    const lastUpdated = { A: '2026-07-31T10:00:00Z', B: '2026-07-31T10:00:00Z' };
    expect(selectStaleFirst(['B', 'A'], lastUpdated, 5)).toEqual(['A', 'B']);
  });
});

describe('budget di esecuzione', () => {
  const start = 1_000_000;

  it('lascia una riserva per scrivere i risultati prima della scadenza', () => {
    expect(hasBudgetLeft(start, 90_000, start + 10_000)).toBe(true);
    expect(hasBudgetLeft(start, 90_000, start + 88_000)).toBe(false);
    expect(hasBudgetLeft(start, 90_000, start + 200_000)).toBe(false);
  });

  it('remainingBudgetMs non scende sotto zero', () => {
    expect(remainingBudgetMs(start, 90_000, start + 30_000)).toBe(60_000);
    expect(remainingBudgetMs(start, 90_000, start + 500_000)).toBe(0);
  });
});

describe('runWithConcurrency', () => {
  it('processa tutti gli item quando il budget regge', async () => {
    const seen: number[] = [];
    const { results, skipped } = await runWithConcurrency(
      [1, 2, 3, 4, 5],
      2,
      async (n) => {
        seen.push(n);
        return n * 2;
      },
    );

    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(results.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10]);
    expect(skipped).toEqual([]);
  });

  it('si ferma e riporta gli item non processati quando il budget finisce', async () => {
    let processed = 0;
    const { skipped } = await runWithConcurrency(
      [1, 2, 3, 4, 5, 6, 7, 8],
      1,
      async () => {
        processed++;
      },
      () => processed < 3,
    );

    expect(processed).toBe(3);
    expect(skipped.length).toBe(5);
  });

  it('non supera il grado di concorrenza richiesto', async () => {
    let inFlight = 0;
    let peak = 0;

    await runWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
    });

    expect(peak).toBeLessThanOrEqual(4);
  });
});

describe('isEuropeanTicker', () => {
  it('riconosce i suffissi di borsa europei', () => {
    expect(isEuropeanTicker('ENI.MI')).toBe(true);
    expect(isEuropeanTicker('sap.de')).toBe(true);
    expect(isEuropeanTicker('AAPL')).toBe(false);
  });
});

describe('sorgente di update-underlying-prices-cron', () => {
  it("non reintroduce l'attesa di 60 secondi tra i batch", () => {
    const source = readCronSource();
    expect(source).not.toMatch(/delay\(\s*60000\s*\)/);
    expect(source).not.toMatch(/await\s+delay\(/);
  });

  it('applica una quota per run e un budget di esecuzione', () => {
    const source = readCronSource();
    expect(source).toContain('selectStaleFirst');
    expect(source).toContain('FINNHUB_MAX_CALLS_PER_RUN');
    expect(source).toContain('hasBudgetLeft');
  });

  it("scrive i prezzi a blocchi cosi' un run troncato non perde tutto", () => {
    const source = readCronSource();
    expect(source).toContain('flushPending');
    expect(source).toContain('UPSERT_FLUSH_SIZE');
  });
});
