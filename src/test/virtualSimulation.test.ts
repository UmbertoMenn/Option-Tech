import { describe, it, expect } from 'vitest';
import {
  apportion,
  buildEmpiricalPutStats,
  buildUniverse,
  drawSample,
  generateRandomPuts,
  GenerateParams,
  ivAtMoneyness,
  monthlyExpiries,
  mulberry32,
  nearestMonthly,
  pickListedStrike,
  putBucket,
  RawPosition,
  specPutExposureEUR,
  theoreticalPremium,
  UniverseUnderlying,
} from '@/lib/virtualSimulation';
import { bsPrice } from '@/lib/stressLab';
import { cashForTargetPatrimony, parseStoredState } from '@/lib/virtualPortfolio';
import { resolveUnderlyingTickerFromMappings, normalizeUnderlying } from '@/lib/underlyingTickerResolve';

const FX = { USD: 1.15, HKD: 9 };
const TODAY = new Date('2026-10-09T12:00:00Z');
const R = 0.04;

/** Premio Black-76 coerente con impliedVolFromPrice (stessa formula), per costruire fixture. */
function putPx(S: number, K: number, T: number, iv: number) {
  return bsPrice(S * Math.exp(R * T), K, T, iv, false, R);
}
const yrs = (from: string, to: string) => (Date.parse(to + 'T16:00:00Z') - Date.parse(from + 'T16:00:00Z')) / (365.25 * 86400000);

describe('resolveUnderlyingTickerFromMappings', () => {
  const maps = [
    { underlying: 'NVIDIA CORP', ticker: 'NVDA' },
    { underlying: 'RAMBUS', ticker: 'RMBS' },
  ];
  it('mapping esatto e normalizzato', () => {
    expect(resolveUnderlyingTickerFromMappings('NVIDIA CORP', maps)).toBe('NVDA');
    expect(resolveUnderlyingTickerFromMappings('Nvidia Corp.', maps)).toBe('NVDA');
  });
  it('mapping ha la precedenza sul ticker formalmente valido', () => {
    expect(resolveUnderlyingTickerFromMappings('RAMBUS', maps)).toBe('RMBS');
  });
  it('fallback ticker valido, altrimenti vuoto', () => {
    expect(resolveUnderlyingTickerFromMappings('AAPL', maps)).toBe('AAPL');
    expect(resolveUnderlyingTickerFromMappings('SOME COMPANY INC', maps)).toBe('');
  });
  it('normalizeUnderlying invariata', () => {
    expect(normalizeUnderlying('Apple Inc.')).toBe('APPLE');
  });
});

describe('ivAtMoneyness', () => {
  const pts = [
    { m: -0.2, iv: 0.6, T: 0.2, date: 'x' },
    { m: 0, iv: 0.4, T: 0.2, date: 'x' },
    { m: 0, iv: 0.42, T: 0.2, date: 'x' },
  ];
  it('interpola linearmente, media i duplicati, piatta agli estremi', () => {
    expect(ivAtMoneyness(pts, 0)).toBeCloseTo(0.41, 6);
    expect(ivAtMoneyness(pts, -0.1)).toBeCloseTo(0.505, 6);
    expect(ivAtMoneyness(pts, -0.5)).toBeCloseTo(0.6, 6);
    expect(ivAtMoneyness(pts, 0.3)).toBeCloseTo(0.41, 6);
  });
  it('null senza punti', () => {
    expect(ivAtMoneyness([], 0)).toBeNull();
    expect(ivAtMoneyness([], 0, 0.2)).toBeNull();
  });
  it('con durata: privilegia i punti di durata e strike vicini, ignora le settimanali se c’è altro', () => {
    const mix = [
      { m: 0, iv: 0.3, T: 7 / 365, date: 'x' }, // settimanale
      { m: 0, iv: 0.45, T: 60 / 365, date: 'x' }, // 2 mesi
      { m: 0, iv: 0.6, T: 2, date: 'x' }, // LEAPS
    ];
    const iv2m = ivAtMoneyness(mix, 0, 60 / 365)!;
    expect(iv2m).toBeGreaterThan(0.45);
    expect(iv2m).toBeLessThan(0.46);
    // senza punti ≥ 10 giorni usa comunque le settimanali
    expect(ivAtMoneyness([mix[0]], 0, 60 / 365)).toBeCloseTo(0.3, 9);
    // a parità di durata pesa lo strike relativo vicino
    const smile = [
      { m: -0.2, iv: 0.6, T: 0.2, date: 'x' },
      { m: 0, iv: 0.4, T: 0.2, date: 'x' },
    ];
    expect(ivAtMoneyness(smile, -0.19, 0.2)!).toBeGreaterThan(0.59);
    expect(ivAtMoneyness(smile, -0.1, 0.2)!).toBeCloseTo(0.5, 6);
    // lontano da tutti: resta nel range dei punti (nessuna estrapolazione)
    const far = ivAtMoneyness(smile, -0.6, 0.2)!;
    expect(far).toBeGreaterThan(0.59);
    expect(far).toBeLessThanOrEqual(0.6);
  });
});

describe('putBucket / apportion', () => {
  it('fasce con banda ATM', () => {
    expect(putBucket(-0.1, 0.02)).toBe('otm');
    expect(putBucket(0.015, 0.02)).toBe('atm');
    expect(putBucket(-0.02, 0.02)).toBe('atm');
    expect(putBucket(0.05, 0.02)).toBe('itm');
  });
  it('resto maggiore, totale = n, ogni quota positiva ≥ 1', () => {
    expect(apportion(10, [0.53, 0.08, 0.39])).toEqual([5, 1, 4]);
    expect(apportion(3, [0.9, 0.05, 0.05])).toEqual([1, 1, 1]);
    expect(apportion(5, [1, 0, 0])).toEqual([5, 0, 0]);
    expect(apportion(2, [0.5, 0.25, 0.25]).reduce((a, b) => a + b, 0)).toBe(2);
  });
});

describe('scadenze e strike', () => {
  it('monthlyExpiries: terzi venerdì futuri con DTE ≥ 7', () => {
    const ex = monthlyExpiries(TODAY, 3);
    expect(ex[0]).toBe('2026-10-16');
    expect(ex[1]).toBe('2026-11-20');
    expect(monthlyExpiries(new Date('2026-10-12T12:00:00Z'), 2)[0]).toBe('2026-11-20');
  });
  it('nearestMonthly', () => {
    const ex = monthlyExpiries(TODAY, 12);
    expect(nearestMonthly(TODAY, 40, ex)).toBe('2026-11-20');
    expect(nearestMonthly(TODAY, 70, ex)).toBe('2026-12-18');
  });
  it('pickListedStrike: catena reale se copre il target, altrimenti regola 2,5/5/10', () => {
    const chains = [{ expiry: '2026-12-18', strikes: [80, 85, 90, 92.5, 95, 100] }];
    expect(pickListedStrike(90.9, 100, '2026-12-18', chains)).toEqual({ K: 90, source: 'chain' });
    // il lato rispetto allo spot non cambia: target 99 (OTM) con catena [.., 95, 100] → 95, non 100
    expect(pickListedStrike(99, 100, '2026-12-18', chains)).toEqual({ K: 95, source: 'chain' });
    expect(pickListedStrike(92, 100, '2026-12-18', chains)).toEqual({ K: 92.5, source: 'chain' });
    // fuori dal range della catena → regola (spot 100 → passo 5)
    expect(pickListedStrike(61, 100, '2026-12-18', chains)).toEqual({ K: 60, source: 'rule' });
    // catena troppo lontana come scadenza → regola
    expect(pickListedStrike(91.4, 100, '2027-06-18', chains).source).toBe('rule');
    expect(pickListedStrike(31.2, 40, '2026-12-18', undefined)).toEqual({ K: 30, source: 'rule' });
    expect(pickListedStrike(333, 350, '2026-12-18', undefined)).toEqual({ K: 330, source: 'rule' });
    // ITM su spot 20 (passo 2,5): 21 → 22,5 (non 20 = ATM)
    expect(pickListedStrike(21, 20, '2026-12-18', undefined)).toEqual({ K: 22.5, source: 'rule' });
    // OTM: 19,5 su spot 20 → 17,5 (non 20)
    expect(pickListedStrike(19.5, 20, '2026-12-18', undefined)).toEqual({ K: 17.5, source: 'rule' });
    // ATM esatto → strike più vicino
    expect(pickListedStrike(100, 100, '2026-12-18', undefined)).toEqual({ K: 100, source: 'rule' });
  });
});

describe('theoreticalPremium', () => {
  it('ricostruisce il premio con l’IV dello smile e non scende sotto l’intrinseco', () => {
    const u = { spot: 100, ivPoints: [{ m: 0, iv: 0.4, T: 0.2, date: 'x' }] };
    const th = theoreticalPremium(u, 'put', 100, '2026-12-18', R, TODAY)!; // un solo punto → IV = 0,40
    const T = (Date.parse('2026-12-18T16:00:00Z') - TODAY.getTime()) / (365.25 * 86400000);
    expect(th.iv).toBeCloseTo(0.4, 9);
    expect(th.price).toBeCloseTo(Math.ceil(putPx(100, 100, T, 0.4) * 100) / 100, 9);
    const deep = theoreticalPremium(u, 'put', 200, '2026-10-16', R, TODAY)!;
    expect(deep.price).toBeGreaterThanOrEqual(100);
    expect(theoreticalPremium({ spot: 100, ivPoints: [] }, 'put', 90, '2026-12-18', R, TODAY)).toBeNull();
    expect(theoreticalPremium(u, 'put', 90, '2026-01-16', R, TODAY)).toBeNull();
  });
});

/* ------------------------------ UNIVERSO ------------------------------ */

function opt(over: Partial<RawPosition>): RawPosition {
  return {
    portfolio_id: 'p1',
    asset_type: 'derivative',
    description: 'NVIDIA CORP OPTION PUT',
    underlying: 'NVIDIA CORP',
    ticker: null,
    option_type: 'put',
    strike_price: 90,
    expiry_date: '2026-12-18',
    quantity: -2,
    snapshot_price: 1,
    current_price: 1,
    currency: 'USD',
    exchange_rate: 1.15,
    ...over,
  };
}

describe('buildUniverse', () => {
  const T1 = yrs('2026-10-08', '2026-12-18');
  const base = {
    mappings: [{ underlying: 'NVIDIA CORP', ticker: 'NVDA' }],
    riskFree: R,
  };

  it('IV dalle opzioni OTM con lo spot congelato dello stesso snapshot; spot live per la generazione', () => {
    const px = putPx(100, 90, T1, 0.5);
    const u = buildUniverse({
      ...base,
      portfolios: [{ id: 'p1', snapshot_date: '2026-10-08' }],
      positions: [opt({ snapshot_price: px })],
      snapshotSpots: { p1: { 'NVIDIA CORP': 100 } },
      liveSpots: { NVDA: { price: 120 } },
    });
    expect(u.underlyings).toHaveLength(1);
    const n = u.underlyings[0];
    expect(n.ticker).toBe('NVDA');
    expect(n.spot).toBe(120);
    expect(n.spotSource).toBe('live');
    expect(n.ivPoints[0].m).toBeCloseTo(-0.1, 9);
    expect(n.ivAtm).toBeCloseTo(0.5, 3);
    expect(n.soldPuts).toBe(1);
    expect(u.instruments[0].iv).toBeCloseTo(0.5, 3);
    // moneyness dello strumento rispetto allo spot dell'universo (live)
    expect(u.instruments[0].moneyness).toBeCloseTo(90 / 120 - 1, 9);
  });

  it('esclude dallo smile le opzioni ITM e quelle di snapshot vecchi > 7 giorni dal più recente', () => {
    const T0 = yrs('2026-09-01', '2026-12-18');
    const u = buildUniverse({
      ...base,
      portfolios: [
        { id: 'p1', snapshot_date: '2026-10-08' },
        { id: 'p2', snapshot_date: '2026-09-01' },
      ],
      positions: [
        opt({ snapshot_price: putPx(100, 90, T1, 0.5) }),
        opt({ strike_price: 120, snapshot_price: putPx(100, 120, T1, 0.5) }), // ITM put → fuori smile
        opt({ portfolio_id: 'p2', strike_price: 80, snapshot_price: putPx(100, 80, T0, 0.9) }), // vecchio
      ],
      snapshotSpots: { p1: { 'NVIDIA CORP': 100 }, p2: { 'NVIDIA CORP': 100 } },
      liveSpots: {},
    });
    const n = u.underlyings[0];
    expect(n.ivPoints).toHaveLength(1);
    expect(n.clients).toBe(2);
    expect(n.spotSource).toBe('snapshot');
    expect(n.spot).toBe(100);
    expect(n.latestDate).toBe('2026-10-08');
  });

  it('scarta sottostanti senza spot o senza IV e opzioni scadute allo snapshot; deduplica gli strumenti', () => {
    const u = buildUniverse({
      ...base,
      portfolios: [
        { id: 'p1', snapshot_date: '2026-10-08' },
        { id: 'p2', snapshot_date: '2026-10-07' },
      ],
      positions: [
        opt({ underlying: 'SOME COMPANY INC' }), // non risolto
        opt({ expiry_date: '2026-09-18' }), // scaduta
        opt({ snapshot_price: putPx(100, 90, T1, 0.5) }),
        opt({ portfolio_id: 'p2', quantity: -3, snapshot_price: putPx(100, 90, yrs('2026-10-07', '2026-12-18'), 0.5) }),
        { portfolio_id: 'p1', asset_type: 'stock', description: 'APPLE', ticker: 'AAPL', snapshot_price: 250, quantity: 100, currency: 'USD' },
      ],
      snapshotSpots: { p1: { 'NVIDIA CORP': 100 }, p2: { 'NVIDIA CORP': 100 } },
      liveSpots: {},
    });
    expect(u.underlyings.map((x) => x.ticker)).toEqual(['NVDA']);
    const put = u.instruments.find((i) => i.kind === 'option')!;
    expect(u.instruments.filter((i) => i.kind === 'option')).toHaveLength(1);
    expect(put.clients).toBe(2);
    expect(put.totalQty).toBe(-5);
    expect(put.latestDate).toBe('2026-10-08');
    const stock = u.instruments.find((i) => i.kind === 'stock')!;
    expect(stock.ticker).toBe('AAPL');
    expect(stock.price).toBe(250);
  });
});

/* ------------------------------ MIX EMPIRICO ------------------------------ */

describe('buildEmpiricalPutStats', () => {
  const snaps = [
    // p1: uno snapshot, due put: OTM -10% (esp 9000) e ITM +10% (esp 11000)
    {
      portfolio_id: 'p1',
      snapshot_date: '2026-09-01',
      positions: [
        opt({ strike_price: 90, quantity: -1, exchange_rate: 1, expiry_date: '2026-10-01' }),
        opt({ strike_price: 110, quantity: -1, exchange_rate: 1, expiry_date: '2026-11-01' }),
        opt({ strike_price: 50, quantity: 1, exchange_rate: 1 }), // comprata → esclusa
        opt({ option_type: 'call', strike_price: 120, quantity: -1 }), // call → esclusa
      ],
    },
    // p2: due snapshot (pesano metà ciascuno), una put ATM ciascuno
    { portfolio_id: 'p2', snapshot_date: '2026-09-01', positions: [opt({ strike_price: 100, quantity: -5, expiry_date: '2026-09-21' })] },
    { portfolio_id: 'p2', snapshot_date: '2026-09-15', positions: [opt({ strike_price: 101, quantity: -5, expiry_date: '2026-10-15' })] },
    // p3: senza spot congelato → escluso
    { portfolio_id: 'p3', snapshot_date: '2026-09-01', positions: [opt({ strike_price: 100 })] },
  ];
  const spots = {
    'p1|2026-09-01': { 'NVIDIA CORP': 100 },
    'p2|2026-09-01': { 'NVIDIA CORP': 100 },
    'p2|2026-09-15': { 'NVIDIA CORP': 100 },
  };

  it('ogni portafoglio pesa uguale, ogni snapshot uguale, dentro lo snapshot pesa l’esposizione', () => {
    const st = buildEmpiricalPutStats(snaps, spots, 0.02);
    expect(st.legs).toBe(4);
    expect(st.portfolios).toBe(2);
    expect(st.snapshots).toBe(3);
    // p1 (peso 0,5): OTM 9000/20000, ITM 11000/20000 ; p2 (peso 0,5): tutto ATM
    expect(st.pct.otm).toBeCloseTo(0.5 * 0.45, 9);
    expect(st.pct.itm).toBeCloseTo(0.5 * 0.55, 9);
    expect(st.pct.atm).toBeCloseTo(0.5, 9);
    expect(st.meanM.otm).toBeCloseTo(-0.1, 9);
    expect(st.meanM.itm).toBeCloseTo(0.1, 9);
    expect(st.meanM.atm).toBeCloseTo(0.005, 9);
    expect(st.firstDate).toBe('2026-09-01');
    expect(st.lastDate).toBe('2026-09-15');
    expect(st.samples.reduce((a, s) => a + s.w, 0)).toBeCloseTo(1, 9);
  });

  it('filtro per data e banda ATM', () => {
    const st = buildEmpiricalPutStats(snaps, spots, 0.02, '2026-09-10');
    expect(st.legs).toBe(1);
    expect(st.pct.atm).toBeCloseTo(1, 9);
    const wide = buildEmpiricalPutStats(snaps, spots, 0.15);
    expect(wide.pct.atm).toBeCloseTo(1, 9);
  });

  it('drawSample estrae solo nella fascia richiesta', () => {
    const st = buildEmpiricalPutStats(snaps, spots, 0.02);
    const rnd = mulberry32(7);
    for (let i = 0; i < 20; i++) expect(drawSample(st.samples, rnd, 'itm', 0.02)!.m).toBeCloseTo(0.1, 9);
    expect(drawSample([], rnd)).toBeNull();
  });
});

/* ------------------------------ GENERATORE ------------------------------ */

function und(t: string, spot: number, iv = 0.5): UniverseUnderlying {
  return {
    ticker: t, name: t, currency: 'USD', spot, spotSource: 'live',
    ivPoints: [{ m: -0.3, iv: iv + 0.1, T: 0.2, date: 'd' }, { m: 0, iv, T: 0.2, date: 'd' }],
    ivAtm: iv, clients: 1, soldPuts: 1, latestDate: 'd',
  };
}

const UNIV = [und('AAA', 100), und('BBB', 50), und('CCC', 250), und('DDD', 400), und('EEE', 20)];

function params(over: Partial<GenerateParams> = {}): GenerateParams {
  return {
    targetExposureEUR: 500_000,
    nUnderlyings: 5,
    mode: 'single',
    singleM: -0.1,
    manual: { otmPct: 0.5, atmPct: 0.2, itmPct: 0.3, otmM: -0.1, atmM: 0, itmM: 0.05 },
    empirical: null,
    expiryMode: 'fixed',
    fixedExpiry: '2026-12-18',
    seed: 42,
    today: TODAY,
    riskFree: R,
    fx: FX,
    chains: {},
    ...over,
  };
}

describe('generateRandomPuts', () => {
  it('livello unico: put vendute OTM al livello scelto, esposizione ≈ obiettivo, premio teorico', () => {
    const r = generateRandomPuts(UNIV, params());
    expect(r.specs).toHaveLength(5);
    expect(new Set(r.specs.map((s) => s.ticker)).size).toBe(5);
    for (const s of r.specs) {
      expect(s.kind).toBe('option');
      expect(s.optionType).toBe('put');
      expect(s.qty).toBeLessThan(0);
      expect(s.origin).toBe('random');
      expect(s.expiry).toBe('2026-12-18');
      expect(s.price).toBeGreaterThan(0);
    }
    for (const row of r.rows) {
      expect(row.m).toBeLessThan(0);
      expect(Math.abs(row.m - -0.1)).toBeLessThan(0.07);
      expect(row.bucket).toBe('otm');
    }
    // arrotondamento ai contratti: entro ±1 contratto per titolo
    expect(Math.abs(r.exposureEUR - 500_000)).toBeLessThan(r.rows.reduce((a, x) => a + (x.K * 100) / FX.USD, 0));
    const sumSpecs = r.specs.reduce((a, s) => a + specPutExposureEUR(s, FX), 0);
    expect(sumSpecs).toBeCloseTo(r.exposureEUR, 6);
  });

  it('livello ITM: strike sopra lo spot', () => {
    const r = generateRandomPuts(UNIV, params({ singleM: 0.05 }));
    for (const row of r.rows) expect(row.K).toBeGreaterThan(row.spot);
  });

  it('stesso seed → stessa estrazione; seed diverso → estrazione diversa', () => {
    const a = generateRandomPuts(UNIV, params({ nUnderlyings: 3 }));
    const b = generateRandomPuts(UNIV, params({ nUnderlyings: 3 }));
    expect(a.rows.map((x) => x.ticker)).toEqual(b.rows.map((x) => x.ticker));
    const seen = new Set<string>();
    for (let s = 1; s < 30; s++) seen.add(generateRandomPuts(UNIV, params({ nUnderlyings: 3, seed: s })).rows.map((x) => x.ticker).sort().join());
    expect(seen.size).toBeGreaterThan(1);
  });

  it('ripartizione manuale: slot per fascia e livelli per fascia', () => {
    const r = generateRandomPuts(UNIV, params({ mode: 'manual', nUnderlyings: 5 }));
    // 5 slot su 50/20/30 → 3 OTM (resto maggiore: 2,5→2 +1), 1 ATM, 1 ITM ... totale 5
    const tm = r.rows.map((x) => x.targetM);
    expect(tm.filter((m) => m === -0.1).length + tm.filter((m) => m === 0).length + tm.filter((m) => m === 0.05).length).toBe(5);
    expect(tm.filter((m) => m === 0).length).toBeGreaterThanOrEqual(1);
    expect(tm.filter((m) => m === 0.05).length).toBeGreaterThanOrEqual(1);
  });

  it('mix empirico: richiede i dati storici, estrae moneyness e scadenze dalle fasce', () => {
    const none = generateRandomPuts(UNIV, params({ mode: 'empirical' }));
    expect(none.specs).toHaveLength(0);
    expect(none.warnings.join()).toMatch(/storici/);
    const empirical = {
      samples: [
        { m: -0.12, dte: 70, w: 0.6 },
        { m: 0.0, dte: 40, w: 0.1 },
        { m: 0.08, dte: 40, w: 0.3 },
      ],
      pct: { otm: 0.6, atm: 0.1, itm: 0.3 },
      meanM: { otm: -0.12, atm: 0, itm: 0.08 },
      medianDte: 70, legs: 3, snapshots: 1, portfolios: 1, firstDate: null, lastDate: null, atmBand: 0.02,
    };
    const r = generateRandomPuts(UNIV, params({ mode: 'empirical', empirical, expiryMode: 'empirical' }));
    expect(r.specs).toHaveLength(5);
    for (const row of r.rows) {
      expect([-0.12, 0, 0.08]).toContain(row.targetM);
      expect(row.expiry).toBe(row.targetM === -0.12 ? '2026-12-18' : '2026-11-20');
    }
  });

  it('casi limite: obiettivo nullo, universo vuoto, N oltre l’universo', () => {
    expect(generateRandomPuts(UNIV, params({ targetExposureEUR: 0 })).specs).toHaveLength(0);
    expect(generateRandomPuts([], params()).specs).toHaveLength(0);
    const r = generateRandomPuts(UNIV, params({ nUnderlyings: 50 }));
    expect(r.specs).toHaveLength(5);
    expect(r.warnings.join()).toMatch(/Solo 5/);
  });

  it('almeno 1 contratto anche se la quota è piccola (con avviso)', () => {
    const r = generateRandomPuts([und('DDD', 400)], params({ targetExposureEUR: 1000, nUnderlyings: 1 }));
    expect(r.specs[0].qty).toBe(-1);
    expect(r.warnings.join()).toMatch(/supera la quota/);
  });
});

describe('patrimonio simulato', () => {
  it('liquidità = obiettivo − (patrimonio − liquidità attuale): punto fisso', () => {
    const c1 = cashForTargetPatrimony(1_000_000, 1_250_000, 300_000);
    expect(c1).toBe(50_000);
    // dopo l'applicazione il patrimonio è 1.000.000 con liquidità 50.000 → stessa liquidità
    expect(cashForTargetPatrimony(1_000_000, 1_000_000, c1)).toBe(c1);
    expect(cashForTargetPatrimony(100_000, 400_000, 0)).toBe(-300_000);
  });
  it('parseStoredState conserva sim e origin, scarta valori non validi', () => {
    const st = parseStoredState(JSON.stringify({
      version: 1, removedKeys: [],
      added: [{ id: 'a', kind: 'option', ticker: 'NVDA', qty: -1, price: 2, optionType: 'put', strike: 90, expiry: '2026-12-18', origin: 'random' }],
      sim: { patrimony: 1e6, exposure: 'x', excludeGP: true },
    }));
    expect(st.sim).toEqual({ patrimony: 1e6, exposure: null, excludeGP: true });
    expect(st.added[0].origin).toBe('random');
    expect(parseStoredState(JSON.stringify({ version: 1, removedKeys: [], added: [] })).sim).toBeUndefined();
  });
});
