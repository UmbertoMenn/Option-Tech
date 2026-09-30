import { describe, it, expect } from 'vitest';
import { Position } from '@/types/portfolio';
import {
  parseVirtualPositionsText,
  parseNum,
  parseExpiry,
  specToPosition,
  buildVirtualPositions,
  positionKey,
  parseStoredState,
  deriveFxRates,
  inferCurrency,
  validateSpec,
  optionDescriptor,
  EMPTY_VIRTUAL_STATE,
  VirtualPositionSpec,
} from '@/lib/virtualPortfolio';

const FX = { USD: 1.17, HKD: 9.1 };

function pos(over: Partial<Position>): Position {
  return {
    id: over.id ?? Math.random().toString(36),
    portfolio_id: 'p1',
    isin: null,
    ticker: null,
    description: 'X',
    asset_type: 'stock',
    currency: 'USD',
    exchange_rate: 1.17,
    quantity: 1,
    current_price: 10,
    avg_cost: null,
    market_value: 10,
    profit_loss: null,
    profit_loss_pct: null,
    weight_pct: null,
    option_type: null,
    strike_price: null,
    expiry_date: null,
    underlying: null,
    snapshot_price: 10,
    snapshot_market_value: 10,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

describe('parseNum', () => {
  it('accetta virgola e punto decimale e migliaia', () => {
    expect(parseNum('7,40')).toBe(7.4);
    expect(parseNum('7.40')).toBe(7.4);
    expect(parseNum('1.234,5')).toBe(1234.5);
    expect(parseNum('1,234.5')).toBe(1234.5);
    expect(parseNum('-2')).toBe(-2);
    expect(parseNum('abc')).toBeNull();
  });
});

describe('parseExpiry', () => {
  it('formati data esplicita', () => {
    expect(parseExpiry('2026-12-18')).toBe('2026-12-18');
    expect(parseExpiry('18/12/2026')).toBe('2026-12-18');
    expect(parseExpiry('18.12.26')).toBe('2026-12-18');
  });
  it('MM/AA → terzo venerdì del mese', () => {
    expect(parseExpiry('12/26')).toBe('2026-12-18');
  });
  it('date impossibili → null', () => {
    expect(parseExpiry('2026-02-30')).toBeNull();
    expect(parseExpiry('13/26')).toBeNull();
  });
});

describe('parseVirtualPositionsText', () => {
  it('titoli, ETF, opzioni e descrittore banca in un unico incolla', () => {
    const { specs, errors } = parseVirtualPositionsText(
      [
        'Ticker Qta Prezzo', // intestazione ignorata
        '# commento',
        'AAPL 100',
        'ENI.MI 500 14,20 EUR',
        'ETF SPY 50',
        'NVDA P 150 2026-12-18 -2 7,40',
        'MSFT\tC\t500\t12/26\t-1\t12,5',
        '[AMZN][03/27][P][180] -3 9,1',
      ].join('\n'),
    );
    expect(errors).toEqual([]);
    expect(specs.map((s) => s.kind)).toEqual(['stock', 'stock', 'etf', 'option', 'option', 'option']);
    expect(specs[0]).toMatchObject({ ticker: 'AAPL', qty: 100 });
    expect(specs[0].price).toBeUndefined();
    expect(specs[1]).toMatchObject({ ticker: 'ENI.MI', qty: 500, price: 14.2, currency: 'EUR' });
    expect(specs[3]).toMatchObject({ ticker: 'NVDA', optionType: 'put', strike: 150, expiry: '2026-12-18', qty: -2, price: 7.4 });
    expect(specs[4]).toMatchObject({ ticker: 'MSFT', optionType: 'call', strike: 500, expiry: '2026-12-18', qty: -1, price: 12.5 });
    expect(specs[5]).toMatchObject({ ticker: 'AMZN', optionType: 'put', strike: 180, expiry: '2027-03-19', qty: -3, price: 9.1 });
    expect(new Set(specs.map((s) => s.id)).size).toBe(specs.length);
  });

  it('ticker "C" (Citigroup) non viene scambiato per call', () => {
    const { specs, errors } = parseVirtualPositionsText('C 200');
    expect(errors).toEqual([]);
    expect(specs[0]).toMatchObject({ kind: 'stock', ticker: 'C', qty: 200 });
  });

  it('opzione senza premio / senza scadenza / contratti frazionari → errore con numero di riga', () => {
    const { specs, errors } = parseVirtualPositionsText(
      ['NVDA P 150 2026-12-18 -2', 'NVDA P 150 -2 7', 'NVDA P 150 2026-12-18 -1,5 7'].join('\n'),
    );
    expect(specs).toEqual([]);
    expect(errors.map((e) => e.line)).toEqual([1, 2, 3]);
    expect(errors[1].reason).toMatch(/scadenza/);
  });

  it('riga con errore non blocca le altre', () => {
    const { specs, errors } = parseVirtualPositionsText('AAPL 10\n??? 5\nMSFT 3');
    expect(specs.map((s) => s.ticker)).toEqual(['AAPL', 'MSFT']);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(2);
  });
});

describe('specToPosition — formato canonico dei flussi', () => {
  it('opzione: descrittore banca, contratti con segno, controvalore EUR assoluto', () => {
    const spec: VirtualPositionSpec = {
      id: 'a', kind: 'option', ticker: 'nvda', qty: -2, price: 7.4, optionType: 'put', strike: 150, expiry: '2026-12-18',
    };
    const p = specToPosition(spec, 'p1', FX)!;
    expect(p.id).toBe('virtual:a');
    expect(p.asset_type).toBe('derivative');
    expect(p.description).toBe('[NVDA][12/26][P][150]');
    expect(p.underlying).toBe('NVDA');
    expect(p.quantity).toBe(-2);
    expect(p.currency).toBe('USD');
    expect(p.exchange_rate).toBe(1.17);
    expect(p.snapshot_market_value).toBeCloseTo((2 * 100 * 7.4) / 1.17, 8);
    expect(p.snapshot_price).toBe(7.4);
  });

  it('opzione senza premio → null (mai prezzo inventato)', () => {
    expect(
      specToPosition({ id: 'a', kind: 'option', ticker: 'NVDA', qty: -1, optionType: 'put', strike: 100, expiry: '2026-12-18' }, 'p1', FX),
    ).toBeNull();
  });

  it('titolo senza prezzo usa il prezzo live e la sua divisa; senza live → null', () => {
    const spec: VirtualPositionSpec = { id: 'b', kind: 'stock', ticker: 'ENI.MI', qty: 100 };
    expect(specToPosition(spec, 'p1', FX)).toBeNull();
    const p = specToPosition(spec, 'p1', FX, { price: 14, currency: 'EUR' })!;
    expect(p.currency).toBe('EUR');
    expect(p.market_value).toBe(1400);
    expect(p.ticker).toBe('ENI.MI');
  });

  it('titolo USD: controvalore convertito in EUR', () => {
    const p = specToPosition({ id: 'c', kind: 'etf', ticker: 'SPY', qty: 10, price: 585 }, 'p1', FX)!;
    expect(p.asset_type).toBe('etf');
    expect(p.market_value).toBeCloseTo(5850 / 1.17, 8);
  });
});

describe('buildVirtualPositions', () => {
  const real = [
    pos({ id: '1', description: 'APPLE INC', ticker: 'AAPL' }),
    pos({ id: '2', description: '[NVDA][12/26][P][150]', asset_type: 'derivative', option_type: 'put', strike_price: 150, expiry_date: '2026-12-18', quantity: -2 }),
  ];

  it('stato vuoto = portafoglio reale identico', () => {
    const r = buildVirtualPositions(real, EMPTY_VIRTUAL_STATE, 'p1', FX, {});
    expect(r.positions).toEqual(real);
    expect(r.pending).toEqual([]);
  });

  it('rimozione per chiave stabile sopravvive al cambio di id (nuovo upload)', () => {
    const state = { version: 1 as const, removedKeys: [positionKey(real[1])], added: [] };
    const reuploaded = real.map((p) => ({ ...p, id: p.id + '-new' }));
    const r = buildVirtualPositions(reuploaded, state, 'p1', FX, {});
    expect(r.positions.map((p) => p.id)).toEqual(['1-new']);
  });

  it('aggiunte senza prezzo restano in pending finché il prezzo live non arriva', () => {
    const state = {
      version: 1 as const,
      removedKeys: [],
      added: [{ id: 'x', kind: 'stock' as const, ticker: 'MSFT', qty: 5 }],
    };
    const before = buildVirtualPositions(real, state, 'p1', FX, {});
    expect(before.positions).toHaveLength(2);
    expect(before.pending.map((s) => s.id)).toEqual(['x']);
    const after = buildVirtualPositions(real, state, 'p1', FX, { MSFT: { price: 400, currency: 'USD' } });
    expect(after.positions.map((p) => p.id)).toEqual(['1', '2', 'virtual:x']);
    expect(after.pending).toEqual([]);
  });
});

describe('positionKey', () => {
  it('distingue opzioni con stesso sottostante ma strike/scadenza diversi', () => {
    const a = pos({ asset_type: 'derivative', description: 'NVDA', option_type: 'put', strike_price: 150, expiry_date: '2026-12-18' });
    const b = pos({ asset_type: 'derivative', description: 'NVDA', option_type: 'put', strike_price: 140, expiry_date: '2026-12-18' });
    expect(positionKey(a)).not.toBe(positionKey(b));
    expect(positionKey(a)).toBe(positionKey({ ...a, id: 'altro' }));
  });
});

describe('parseStoredState', () => {
  it('JSON corrotto, versione ignota o voci malformate → stato sicuro', () => {
    expect(parseStoredState(null)).toEqual(EMPTY_VIRTUAL_STATE);
    expect(parseStoredState('{nope')).toEqual(EMPTY_VIRTUAL_STATE);
    expect(parseStoredState(JSON.stringify({ version: 2 }))).toEqual(EMPTY_VIRTUAL_STATE);
    const s = parseStoredState(
      JSON.stringify({
        version: 1,
        removedKeys: ['k', 3],
        added: [{ id: 'a', kind: 'stock', ticker: 'AAPL', qty: 1 }, { id: 'b', kind: 'weird', ticker: 'X', qty: 1 }, null],
      }),
    );
    expect(s.removedKeys).toEqual(['k']);
    expect(s.added.map((a) => a.id)).toEqual(['a']);
  });
});

describe('fx / divisa', () => {
  it('deriveFxRates: prima USD non-derivata, fallback default', () => {
    expect(deriveFxRates([pos({ asset_type: 'derivative', exchange_rate: 1.2 }), pos({ exchange_rate: 1.16 })]).USD).toBe(1.16);
    expect(deriveFxRates([]).USD).toBe(1.15);
  });
  it('inferCurrency da suffisso', () => {
    expect(inferCurrency('AAPL')).toBe('USD');
    expect(inferCurrency('ENI.MI')).toBe('EUR');
    expect(inferCurrency('0700.HK')).toBe('HKD');
    expect(inferCurrency('BRK.B')).toBe('USD');
  });
});

describe('validateSpec', () => {
  it('opzione richiede premio, strike, scadenza e contratti interi', () => {
    const base = { kind: 'option' as const, ticker: 'NVDA', qty: -1, optionType: 'put' as const, strike: 150, expiry: '2026-12-18', price: 5 };
    expect(validateSpec(base)).toBeNull();
    expect(validateSpec({ ...base, price: undefined })).toMatch(/Premio/);
    expect(validateSpec({ ...base, qty: -1.5 })).toMatch(/intero/);
    expect(validateSpec({ ...base, expiry: '' })).toMatch(/Scadenza/);
  });
  it('titolo: prezzo facoltativo', () => {
    expect(validateSpec({ kind: 'stock', ticker: 'AAPL', qty: 10 })).toBeNull();
    expect(validateSpec({ kind: 'stock', ticker: 'AAPL', qty: 0 })).toMatch(/Quantità/);
  });
});

it('optionDescriptor coincide col formato dei flussi', () => {
  expect(optionDescriptor('aapl', '2027-01-15', 'call', 300)).toBe('[AAPL][01/27][C][300]');
  expect(optionDescriptor('F', '2026-11-20', 'put', 12.5)).toBe('[F][11/26][P][12.5]');
});
