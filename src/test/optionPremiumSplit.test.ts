import { describe, expect, it } from 'vitest';
import { OptionLegInput, resolveOptionPremiumSplits } from '@/lib/optionPremiumSplit';

let seq = 0;
function leg(overrides: Partial<OptionLegInput>): OptionLegInput {
  seq += 1;
  return {
    source: 'titoli',
    rowKey: `k${seq}`,
    accountId: '02805213452',
    scope: 'portfolio',
    kind: 'sell',
    effectiveDate: '2026-08-21',
    bookingDate: null,
    valueDate: null,
    operationDate: null,
    causale: 'VEN',
    causaleDescription: null,
    operationId: null,
    description: '',
    isin: null,
    descriptor: null,
    underlyingTicker: 'MU',
    optionType: 'put',
    strike: null,
    expiryDate: '2026-09-18',
    positionSide: null,
    quantity: 1,
    price: 0,
    currency: 'USD',
    exchangeRate: 1.17,
    grossEur: 0,
    accruedEur: 0,
    netEur: 0,
    commissionEur: 0,
    fxCommissionEur: 0,
    taxEur: 0,
    bolliEur: 0,
    unexplainedChargeEur: 0,
    periodStart: null,
    periodEnd: null,
    underlyingKey: 'MU',
    underlyingPrice: null,
    manualTimeValuePerShare: null,
    ...overrides,
  };
}

function option(kind: 'buy' | 'sell', descriptor: string, strike: number, price: number, close: number, extra: Partial<OptionLegInput> = {}) {
  return leg({ kind, causale: kind === 'buy' ? 'ACQ' : 'VEN', descriptor, description: descriptor, strike, price, underlyingPrice: close, ...extra });
}

describe('resolveOptionPremiumSplits — premio temporale dagli eseguiti', () => {
  it('1. assegnazione → vendita azioni → nuova put: spot = prezzo di vendita delle azioni', () => {
    const rows = [
      leg({ kind: 'option_exercise', causale: 'EPV', descriptor: 'WDCQ6P550', underlyingTicker: 'WDC', underlyingKey: 'WDC', strike: 550, positionSide: 'short', effectiveDate: '2026-08-20', expiryDate: '2026-08-21' }),
      leg({ kind: 'buy', causale: 'ACQ', isin: 'US9581021055', description: 'WESTERN DIGITAL CORP', optionType: null, underlyingTicker: null, underlyingKey: 'WDC', quantity: 100, price: 550, effectiveDate: '2026-08-20' }),
      leg({ kind: 'sell', causale: 'VEN', isin: 'US9581021055', description: 'WESTERN DIGITAL CORP', optionType: null, underlyingTicker: null, underlyingKey: 'WDC', quantity: 100, price: 461.3005, effectiveDate: '2026-08-21' }),
      option('sell', 'WDCU6P550', 550, 97, 480, { underlyingTicker: 'WDC', underlyingKey: 'WDC', effectiveDate: '2026-08-21' }),
    ];
    const split = resolveOptionPremiumSplits(rows).get(rows[3].rowKey)!;
    expect(split.method).toBe('assignment_resale');
    expect(split.referenceSpot).toBeCloseTo(461.3005, 6);
    expect(split.intrinsicPerShare).toBeCloseTo(88.6995, 6);
    expect(split.timeValuePerShare).toBeCloseTo(8.3005, 6); // 97 − (550 − 461,3005)
  });

  it('2. roll stesso strike: premio temporale = premio nuova − premio vecchia', () => {
    const old = option('buy', 'MUQ6P780', 780, 41, 740, { expiryDate: '2026-08-21' });
    const fresh = option('sell', 'MUU6P780', 780, 55, 740);
    const splits = resolveOptionPremiumSplits([old, fresh]);
    expect(splits.get(old.rowKey)).toMatchObject({ method: 'roll_same_strike', intrinsicPerShare: 41, timeValuePerShare: 0 });
    expect(splits.get(fresh.rowKey)?.method).toBe('roll_same_strike');
    expect(splits.get(fresh.rowKey)?.timeValuePerShare).toBeCloseTo(14, 6);
  });

  it('3. roll su strike inferiore: tempo = (premio nuova + (strike vecchio − strike nuovo)) − premio vecchia', () => {
    const old = option('buy', 'MUQ6P780', 780, 41, 740, { expiryDate: '2026-08-21' });
    const fresh = option('sell', 'MUU6P760', 760, 30, 740);
    const split = resolveOptionPremiumSplits([old, fresh]).get(fresh.rowKey)!;
    expect(split.method).toBe('roll_new_strike');
    expect(split.referenceSpot).toBeCloseTo(739, 6);
    expect(split.timeValuePerShare).toBeCloseTo((30 + (780 - 760)) - 41, 6);

    // Se lo strike nuovo è sotto lo spot implicito il premio nuovo è tutto tempo.
    const otm = option('sell', 'MUU6P700', 700, 12, 740);
    const otmSplit = resolveOptionPremiumSplits([option('buy', 'MUQ6P780', 780, 41, 740, { expiryDate: '2026-08-21' }), otm]).get(otm.rowKey)!;
    expect(otmSplit.timeValuePerShare).toBeCloseTo(12, 6);
  });

  it('roll di una put ancora OTM: nessuno spot implicito, vale la chiusura', () => {
    const old = option('buy', 'MUQ6P700', 700, 2, 800, { expiryDate: '2026-08-21' });
    const fresh = option('sell', 'MUU6P700', 700, 20, 800);
    const splits = resolveOptionPremiumSplits([old, fresh]);
    expect(splits.get(fresh.rowKey)).toMatchObject({ method: 'close', timeValuePerShare: 20, intrinsicPerShare: 0 });
    expect(splits.get(old.rowKey)?.method).toBe('close');
  });

  it('roll di covered call ITM (salita): regola simmetrica sulle call', () => {
    const old = option('buy', 'MRVLQ6C230', 230, 12, 241, { optionType: 'call', underlyingTicker: 'MRVL', underlyingKey: 'MRVL', expiryDate: '2026-08-21' });
    const fresh = option('sell', 'MRVLU6C240', 240, 21.1, 241, { optionType: 'call', underlyingTicker: 'MRVL', underlyingKey: 'MRVL' });
    const split = resolveOptionPremiumSplits([old, fresh]).get(fresh.rowKey)!;
    expect(split.method).toBe('roll_new_strike');
    expect(split.referenceSpot).toBeCloseTo(242, 6);
    // Call: tempo = (premio nuova + (strike nuovo − strike vecchio)) − premio vecchia
    expect(split.timeValuePerShare).toBeCloseTo((21.1 + (240 - 230)) - 12, 6);
  });

  it('4. put ITM venduta da nuova (covered call sintetica): stima da chiusura, segnalata e correggibile', () => {
    const fresh = option('sell', 'WDCU6P550', 550, 60, 500, { underlyingTicker: 'WDC', underlyingKey: 'WDC' });
    const estimated = resolveOptionPremiumSplits([fresh]).get(fresh.rowKey)!;
    expect(estimated).toMatchObject({ method: 'close_itm_estimate', intrinsicPerShare: 50, timeValuePerShare: 10 });

    const corrected = resolveOptionPremiumSplits([{ ...fresh, manualTimeValuePerShare: 12 }]).get(fresh.rowKey)!;
    expect(corrected).toMatchObject({ method: 'manual', intrinsicPerShare: 48, timeValuePerShare: 12, automaticTimeValuePerShare: 10 });

    // La correzione non può superare il premio incassato.
    const capped = resolveOptionPremiumSplits([{ ...fresh, manualTimeValuePerShare: 80 }]).get(fresh.rowKey)!;
    expect(capped).toMatchObject({ timeValuePerShare: 60, intrinsicPerShare: 0 });
  });

  it('senza prezzo del sottostante lo split resta aperto (il motore usa gli snapshot)', () => {
    const fresh = option('sell', 'WDCU6P550', 550, 60, 0);
    expect(resolveOptionPremiumSplits([fresh]).get(fresh.rowKey)).toMatchObject({ method: 'missing', timeValuePerShare: null });
  });
});

describe('parseDecimalInput — campo premio temporale manuale', () => {
  it('accetta punto e virgola come separatore decimale', async () => {
    const { parseDecimalInput } = await import('@/lib/formatters');
    expect(parseDecimalInput('8.30')).toBe(8.3);
    expect(parseDecimalInput('8,30')).toBe(8.3);
    expect(parseDecimalInput(' 12.5 ')).toBe(12.5);
    expect(parseDecimalInput('0.05')).toBe(0.05);
    expect(parseDecimalInput('1.234,56')).toBe(1234.56);
    expect(parseDecimalInput('1,234.56')).toBe(1234.56);
    expect(parseDecimalInput('7')).toBe(7);
    expect(parseDecimalInput('')).toBeNull();
    expect(parseDecimalInput('abc')).toBeNull();
    expect(parseDecimalInput('8.3.0')).toBeNull();
  });
});
