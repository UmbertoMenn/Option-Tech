import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  frontMonthlyExpiry,
  monthlyExpiriesFrom,
  thirdFridayUTC,
} from '@/lib/backtesting/shortPut/expiryCalendar';
import {
  createFillEngine,
  netPremiumPct,
  premiumPct,
  selectDownsideRoll,
  selectEntryStrike,
  selectRollToFront,
  selectUpsideRollFront,
} from '@/lib/backtesting/shortPut/strikeSelection';
import { runShortPutBacktest, validateShortPutConfig } from '@/lib/backtesting/shortPut/engine';
import {
  SyntheticMarketDataProvider,
  SyntheticSymbolParams,
} from '@/lib/backtesting/shortPut/syntheticProvider';
import { DEFAULT_SHORT_PUT_CONFIG, PutQuote, ShortPutConfig } from '@/lib/backtesting/shortPut/types';

const NATURAL_FILLS = createFillEngine({ fillModel: 'natural', slippagePctOfHalfSpread: 0, commissionPerContract: 0 });

function q(expiration: string, strike: number, bid: number, ask?: number): PutQuote {
  return { expiration, strike, bid, ask: ask ?? bid + 0.1 };
}

function baseConfig(overrides: Partial<ShortPutConfig> = {}): ShortPutConfig {
  return structuredClone({ ...DEFAULT_SHORT_PUT_CONFIG, ...overrides });
}

describe('calendario scadenze mensili', () => {
  it('calcola il terzo venerdì', () => {
    expect(thirdFridayUTC(2026, 0)).toBe('2026-01-16');
    expect(thirdFridayUTC(2026, 6)).toBe('2026-07-17');
    expect(thirdFridayUTC(2024, 2)).toBe('2024-03-15');
  });

  it('la prima scadenza rispetta il DTE minimo di 10', () => {
    // Il 10/07/2026 la mensile di luglio (17/07) ha solo 7 DTE → si passa ad agosto.
    expect(frontMonthlyExpiry('2026-07-10', 10)).toBe('2026-08-21');
    // Il 06/07/2026 luglio ha 11 DTE → resta luglio.
    expect(frontMonthlyExpiry('2026-07-06', 10)).toBe('2026-07-17');
  });

  it('elenca le mensili successive in ordine entro il cap', () => {
    const expiries = monthlyExpiriesFrom('2026-01-05', 0, 3);
    expect(expiries[0]).toBe('2026-01-16');
    expect(expiries).toContain('2026-02-20');
    expect(expiries).toContain('2026-03-20');
    expect(expiries.every((e, i, arr) => i === 0 || arr[i - 1] < e)).toBe(true);
  });
});

describe('selezione strike di ingresso', () => {
  const exp = '2026-08-21';
  const spot = 100;
  const chain = [q(exp, 85, 0.8), q(exp, 90, 1.5), q(exp, 92.5, 1.85), q(exp, 95, 2.6), q(exp, 97.5, 3.4)];

  it('modalità distance: strike più alto sotto la soglia di distanza', () => {
    const entry = { strikeMode: 'distance' as const, distancePct: 5, premiumTargetPct: 2, premiumTolerancePct: 1, minDte: 10 };
    // max strike = 95 → sceglie 95
    expect(selectEntryStrike(chain, exp, spot, entry, NATURAL_FILLS)?.strike).toBe(95);
  });

  it('modalità premium: premio in target ± tolleranza, il più vicino al target', () => {
    const entry = { strikeMode: 'premium' as const, distancePct: 0, premiumTargetPct: 2, premiumTolerancePct: 0.5, minDte: 10 };
    // premi %: 85→0.94, 90→1.67, 92.5→2.0, 95→2.74, 97.5→3.49 → sceglie 92.5
    const selected = selectEntryStrike(chain, exp, spot, entry, NATURAL_FILLS);
    expect(selected?.strike).toBe(92.5);
    expect(premiumPct(NATURAL_FILLS.sellFill(selected!), selected!.strike)).toBeCloseTo(2, 1);
  });

  it('modalità both: vincolo distanza + premio in tolleranza', () => {
    const entry = { strikeMode: 'both' as const, distancePct: 6, premiumTargetPct: 2, premiumTolerancePct: 0.5, minDte: 10 };
    // max strike = 94 → 95 escluso anche se in tolleranza; resta 92.5
    expect(selectEntryStrike(chain, exp, spot, entry, NATURAL_FILLS)?.strike).toBe(92.5);
  });

  it('nessun candidato in tolleranza → null (ingresso rimandato)', () => {
    const entry = { strikeMode: 'premium' as const, distancePct: 0, premiumTargetPct: 10, premiumTolerancePct: 0.2, minDte: 10 };
    expect(selectEntryStrike(chain, exp, spot, entry, NATURAL_FILLS)).toBeNull();
  });
});

describe('roll in discesa', () => {
  const current = q('2026-08-21', 95, 4.8, 5.0);
  const rule = { netPremiumTargetPct: 2, netPremiumTolerancePct: 0.5 };

  it('prima scadenza utile, strike più basso tra i candidati in tolleranza', () => {
    const chain = [
      current,
      // Settembre: netto% = (bid − 5.0) / strike × 100
      q('2026-09-18', 85, 6.7), // (6.7−5)/85 = 2.0%
      q('2026-09-18', 87.5, 6.9), // (6.9−5)/87.5 = 2.17%
      q('2026-09-18', 90, 6.2), // 1.33% → fuori tolleranza
      q('2026-10-16', 80, 6.7), // in tolleranza ma scadenza più lontana → non considerata
    ];
    const rolled = selectDownsideRoll(chain, ['2026-09-18', '2026-10-16'], current, rule, NATURAL_FILLS);
    // 85 e 87.5 entrambi in tolleranza su settembre → sceglie 85 (più difensivo)
    expect(rolled?.strike).toBe(85);
    expect(rolled?.expiration).toBe('2026-09-18');
  });

  it('se la prima mensile non offre il premio, passa alla successiva', () => {
    const chain = [
      current,
      q('2026-09-18', 90, 5.3), // 0.33% → no
      q('2026-10-16', 85, 6.8), // (6.8−5)/85 = 2.12% → sì
    ];
    const rolled = selectDownsideRoll(chain, ['2026-09-18', '2026-10-16'], current, rule, NATURAL_FILLS);
    expect(rolled?.expiration).toBe('2026-10-16');
    expect(rolled?.strike).toBe(85);
  });

  it('esclude strike non inferiori al corrente e ritorna null se nulla è in tolleranza', () => {
    const chain = [current, q('2026-09-18', 95, 7.0), q('2026-09-18', 100, 9.0)];
    expect(selectDownsideRoll(chain, ['2026-09-18'], current, rule, NATURAL_FILLS)).toBeNull();
  });
});

describe('roll al rialzo', () => {
  const upside = {
    triggerDistancePct: 8,
    minDistancePct: 5,
    minNetPremiumPct: 0.5,
    recoveryNetPremiumTargetPct: 2,
    recoveryNetPremiumTolerancePct: 0.5,
  };

  it('prima scadenza: strike più alto con distanza minima e netto ≥ soglia', () => {
    const spot = 110;
    const current = q('2026-08-21', 95, 0.55, 0.65);
    const chain = [
      current,
      q('2026-08-21', 100, 1.2), // netto (1.2−0.65)/100 = 0.55% ✓, strike ≤ 104.5 ✓
      q('2026-08-21', 102.5, 1.5), // (1.5−0.65)/102.5 = 0.83% ✓
      q('2026-08-21', 105, 2.1), // 105 > 104.5 → escluso per distanza
    ];
    const rolled = selectUpsideRollFront(chain, '2026-08-21', spot, current, upside, NATURAL_FILLS);
    expect(rolled?.strike).toBe(102.5);
  });

  it('rientro da scadenza lontana sulla front: netto in target ± tolleranza, tie sul più vicino al target', () => {
    const spot = 110;
    const current = q('2026-12-18', 90, 5.4, 5.6); // posizione su scadenza lontana
    const chain = [
      current,
      q('2026-08-21', 100, 7.4), // netto (7.4−5.6)/100 = 1.8% → in tolleranza
      q('2026-08-21', 102.5, 7.8), // (7.8−5.6)/102.5 = 2.15% → in tolleranza, più vicino al 2%
      q('2026-08-21', 104.5, 8.8), // (8.8−5.6)/104.5 = 3.06% → fuori
    ];
    const rolled = selectRollToFront(chain, '2026-08-21', spot, current, upside, NATURAL_FILLS);
    expect(rolled?.strike).toBe(102.5);
    expect(netPremiumPct(NATURAL_FILLS.sellFill(rolled!), NATURAL_FILLS.buyFill(current), rolled!.strike)).toBeCloseTo(2.15, 2);
  });
});

describe('motore end-to-end su dati sintetici', () => {
  const params = (over: Partial<SyntheticSymbolParams> = {}): SyntheticSymbolParams => ({
    initialPrice: 100,
    impliedVol: 0.28,
    drift: 0.05,
    realizedVol: 0.2,
    spreadPct: 4,
    seed: 42,
    ...over,
  });

  it('valida la configurazione e rifiuta paniere vuoto o regole incomplete', () => {
    const bad = baseConfig({ basket: [] });
    expect(validateShortPutConfig(bad)).not.toHaveLength(0);
    expect(validateShortPutConfig(baseConfig())).toHaveLength(0);
  });

  it('apre la posizione, la mantiene su mensili e produce equity curve completa', async () => {
    const config = baseConfig({
      basket: [{ symbol: 'TEST', contracts: 2 }],
      startDate: '2026-01-05',
      endDate: '2026-06-30',
    });
    const provider = new SyntheticMarketDataProvider(new Map([['TEST', params()]]), config.startDate, config.endDate);
    const result = await runShortPutBacktest(config, provider, 'synthetic');

    expect(result.events.some((e) => e.type === 'entry')).toBe(true);
    const days = await provider.getTradingDays('TEST', config.startDate, config.endDate);
    expect(result.equityCurve).toHaveLength(days.length);
    // Nessun look-ahead grossolano: la prima equity è vicina al capitale iniziale.
    expect(Math.abs(result.equityCurve[0].equity - config.initialCapital)).toBeLessThan(config.initialCapital * 0.02);
    // Contabilità coerente: PL = premi netti + assegnazioni − commissioni − MTM aperto.
    const s = result.bySymbol[0];
    expect(s.realizedPL).toBeCloseTo(s.netPremiums + s.assignmentPL - s.commissions, 6);
  });

  it('in crollo verticale esegue i roll in discesa in sequenza e dopo il roll 4 accetta assegnazione', async () => {
    // Percorso forzato: -1.2% al giorno per 6 mesi → trigger discesa ripetuti.
    const start = '2026-01-05';
    const end = '2026-07-31';
    const override = new Map<string, number>();
    let price = 100;
    let cursor = start;
    const provider0 = new SyntheticMarketDataProvider(new Map([['CRASH', params()]]), start, end);
    const allDays = await provider0.getTradingDays('CRASH', start, '2027-08-31');
    for (const day of allDays) {
      override.set(day, price);
      if (day <= end) price *= 0.988;
    }
    void cursor;

    const config = baseConfig({
      basket: [{ symbol: 'CRASH', contracts: 1 }],
      startDate: start,
      endDate: end,
      downside: {
        triggerDistancePct: 0,
        rolls: [
          { netPremiumTargetPct: 2, netPremiumTolerancePct: 2 },
          { netPremiumTargetPct: 2, netPremiumTolerancePct: 2 },
          { netPremiumTargetPct: 1.5, netPremiumTolerancePct: 2 },
          { netPremiumTargetPct: 1, netPremiumTolerancePct: 2 },
        ],
        maxMonthsForward: 12,
      },
    });
    const provider = new SyntheticMarketDataProvider(
      new Map([['CRASH', params()]]),
      start,
      end,
      new Map([['CRASH', override]]),
    );
    const result = await runShortPutBacktest(config, provider, 'synthetic');

    const rollDowns = result.events.filter((e) => e.type === 'roll_down');
    expect(rollDowns.length).toBeGreaterThanOrEqual(4);
    // rollCount cresce 1→4 nel primo ciclo.
    expect(rollDowns.slice(0, 4).map((e) => e.rollCount)).toEqual([1, 2, 3, 4]);
    // Ogni roll in discesa scende di strike e allunga la scadenza.
    for (const e of rollDowns) {
      expect(e.to!.strike).toBeLessThan(e.from!.strike as number);
      expect(e.to!.expiration > (e.from!.expiration as string)).toBe(true);
    }
    // Dopo il 4° roll: max_rolls_reached e nessun 5° roll nello stesso ciclo.
    expect(result.events.some((e) => e.type === 'max_rolls_reached')).toBe(true);
    const perdita = result.events.find((e) => e.type === 'assignment');
    // In un crollo del genere l'assegnazione finale è attesa (se la scadenza cade nel periodo).
    if (perdita) expect(perdita.cashFlow).toBeLessThan(0);
  });

  it('in forte rialzo esegue roll al rialzo mantenendo distanza minima dallo spot', async () => {
    const start = '2026-01-05';
    const end = '2026-06-30';
    const override = new Map<string, number>();
    let price = 100;
    const provider0 = new SyntheticMarketDataProvider(new Map([['MOON', params()]]), start, end);
    const allDays = await provider0.getTradingDays('MOON', start, '2027-07-31');
    for (const day of allDays) {
      override.set(day, price);
      if (day <= end) price *= 1.006;
    }

    const config = baseConfig({
      basket: [{ symbol: 'MOON', contracts: 1 }],
      startDate: start,
      endDate: end,
      upside: {
        triggerDistancePct: 8,
        minDistancePct: 5,
        minNetPremiumPct: 0.1,
        recoveryNetPremiumTargetPct: 2,
        recoveryNetPremiumTolerancePct: 1,
      },
    });
    const provider = new SyntheticMarketDataProvider(
      new Map([['MOON', params()]]),
      start,
      end,
      new Map([['MOON', override]]),
    );
    const result = await runShortPutBacktest(config, provider, 'synthetic');

    const rollUps = result.events.filter((e) => e.type === 'roll_up');
    expect(rollUps.length).toBeGreaterThan(0);
    for (const e of rollUps) {
      expect(e.to!.strike).toBeGreaterThan(e.from!.strike as number);
      // Distanza minima 5% dallo spot rispettata al momento del roll.
      expect(e.to!.strike).toBeLessThanOrEqual(e.spot * 0.95 + 1e-9);
      // rollCount azzerato: rientro in ciclo pulito.
      expect(e.rollCount).toBe(0);
    }
    // In rialzo costante il P&L deve essere positivo (si incassano premi senza assegnazioni).
    expect(result.totalPL).toBeGreaterThan(0);
    expect(result.bySymbol[0].assignments).toBe(0);
  });

  it('gestisce un paniere multi-titolo con cassa unica e posizioni indipendenti', async () => {
    const config = baseConfig({
      basket: [
        { symbol: 'AAA', contracts: 1 },
        { symbol: 'BBB', contracts: 3 },
      ],
      startDate: '2026-01-05',
      endDate: '2026-04-30',
    });
    const provider = new SyntheticMarketDataProvider(
      new Map([
        ['AAA', params({ seed: 7 })],
        ['BBB', params({ seed: 11, initialPrice: 250 })],
      ]),
      config.startDate,
      config.endDate,
    );
    const result = await runShortPutBacktest(config, provider, 'synthetic');
    expect(result.bySymbol.map((s) => s.symbol).sort()).toEqual(['AAA', 'BBB']);
    expect(result.bySymbol.every((s) => s.entries >= 1)).toBe(true);
    const totalRealized = result.bySymbol.reduce((acc, s) => acc + s.realizedPL, 0);
    // Cassa finale = capitale + realizzato (le posizioni aperte pesano solo sull'equity).
    const lastCash = result.equityCurve[result.equityCurve.length - 1].cash;
    expect(lastCash).toBeCloseTo(config.initialCapital + totalRealized, 4);
  });
});
