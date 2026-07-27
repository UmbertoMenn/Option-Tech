import { describe, it, expect } from 'vitest';
import { extractCallBuybacks, mergeIdenticalTranches, trancheKey, computeAvailableCallResiduals } from '@/lib/callBuybacks';
import { CallBuybackRow, openCallBuybacksValueEUR, openCallBuybacksGainLossEUR, hasKnownMarketPrice, unknownMarketPriceCount } from '@/hooks/useCallBuybacks';
import { FlussiTitoliOptionTrade } from '@/lib/flussiCsvParser';
import { StrategyConfiguration } from '@/hooks/useStrategyConfigurations';
import { Position } from '@/types/portfolio';

function trade(partial: Partial<FlussiTitoliOptionTrade> & { descriptor: string; underlyingTicker: string; optionType: 'call' | 'put'; strike: number; expiryDate: string; side: 'ACQ' | 'VEN'; contracts: number; pricePerShare: number }): FlussiTitoliOptionTrade {
  return {
    accountId: '02278918441',
    currency: 'USD',
    exchangeRate: 1.14,
    grossEUR: 0,
    commission: 8.74,
    tradeDate: '2026-07-02',
    ...partial,
  };
}

function soldCallPosition(underlying: string, strike: number, expiry: string, qty = -1): Position {
  return {
    id: `pos_${underlying}_${strike}`,
    portfolio_id: 'pf1',
    description: `${underlying} call ${strike}`,
    underlying,
    asset_type: 'derivative',
    option_type: 'call',
    strike_price: strike,
    expiry_date: expiry,
    quantity: qty,
    currency: 'USD',
    current_price: 1,
    market_value: 100,
    created_at: '',
    updated_at: '',
  } as unknown as Position;
}

function ccConfig(underlying: string, strike: number, expiry: string): StrategyConfiguration {
  return {
    id: `cfg_${underlying}`,
    portfolio_id: 'pf1',
    underlying,
    strategy_type: 'covered_call',
    position_signatures: [{ option_type: 'call', strike, expiry, quantity_sign: -1, quantity_abs: 1 }],
    is_synthetic: false,
    linked_stock_id: 'stock1',
    linked_stock_slot_ids: [],
    sort_order: 0,
    created_at: '',
    updated_at: '',
  } as unknown as StrategyConfiguration;
}

describe('extractCallBuybacks', () => {
  it('ACQ di una call venduta in posizione → riacquisto tracciato con prezzo', () => {
    const trades = [
      trade({ descriptor: 'MUQ6C1100', underlyingTicker: 'MU', optionType: 'call', strike: 1100, expiryDate: '2026-08-21', side: 'ACQ', contracts: 2, pricePerShare: 45.5 }),
    ];
    const positions = [soldCallPosition('MU', 1100, '2026-08-21', -2)];

    const { buybacks, resells } = extractCallBuybacks(trades, positions, []);
    expect(buybacks).toHaveLength(1);
    expect(buybacks[0].buyback_price).toBe(45.5);
    expect(buybacks[0].quantity).toBe(2);
    expect(buybacks[0].expiry_date).toBe('2026-08-21');
    expect(resells).toHaveLength(0);
  });

  describe('openCallBuybacksValueEUR', () => {
    it('converte il valore di mercato delle call aperte in EUR', () => {
      const rows: CallBuybackRow[] = [{
        id: 'buyback-1',
        portfolio_id: 'pf1',
        underlying: 'MU',
        descriptor: 'MUQ6C1100',
        strike: 1100,
        expiry_date: '2026-08-21',
        quantity: 2,
        buyback_price: 45.5,
        currency: 'USD',
        exchange_rate: 1.25,
        buyback_date: '2026-07-02',
        market_price: 50,
        market_price_updated_at: null,
        resold_quantity: 0,
        resell_price: null,
        resell_date: null,
        included_in_netting: true,
        manually_edited: false,
      }];

      expect(openCallBuybacksValueEUR(rows, '2026-07-10')).toBe(8000);
    });

    it('esclude le call scadute', () => {
      const row = {
        id: 'buyback-1',
        portfolio_id: 'pf1',
        underlying: 'MU',
        descriptor: 'MUQ6C1100',
        strike: 1100,
        expiry_date: '2026-07-01',
        quantity: 1,
        buyback_price: 45.5,
        currency: 'USD',
        exchange_rate: 1,
        buyback_date: '2026-06-02',
        market_price: 50,
        market_price_updated_at: null,
        resold_quantity: 0,
        resell_price: null,
        resell_date: null,
        included_in_netting: true,
        manually_edited: false,
      } satisfies CallBuybackRow;

      expect(openCallBuybacksValueEUR([row], '2026-07-10')).toBe(0);
    });
  });

  describe('openCallBuybacksGainLossEUR', () => {
    it('converte il G/P potenziale (mercato - riacquisto) in EUR', () => {
      const rows: CallBuybackRow[] = [{
        id: 'buyback-1',
        portfolio_id: 'pf1',
        underlying: 'MU',
        descriptor: 'MUQ6C1100',
        strike: 1100,
        expiry_date: '2026-08-21',
        quantity: 2,
        buyback_price: 45.5,
        currency: 'USD',
        exchange_rate: 1.25,
        buyback_date: '2026-07-02',
        market_price: 50,
        market_price_updated_at: null,
        resold_quantity: 0,
        resell_price: null,
        resell_date: null,
        included_in_netting: true,
        manually_edited: false,
      }];

      // (50 - 45.5) * 100 * 2 / 1.25 = 720
      expect(openCallBuybacksGainLossEUR(rows, '2026-07-10')).toBeCloseTo(720);
    });

    it('somma correttamente più riacquisti in valute diverse (nessun mix senza conversione)', () => {
      const rows: CallBuybackRow[] = [
        {
          id: 'buyback-usd',
          portfolio_id: 'pf1',
          underlying: 'MU',
          descriptor: 'MUQ6C1100',
          strike: 1100,
          expiry_date: '2026-08-21',
          quantity: 1,
          buyback_price: 40,
          currency: 'USD',
          exchange_rate: 1.25,
          buyback_date: '2026-07-02',
          market_price: 50,
          market_price_updated_at: null,
          resold_quantity: 0,
          resell_price: null,
          resell_date: null,
          included_in_netting: true,
          manually_edited: false,
        },
        {
          id: 'buyback-eur',
          portfolio_id: 'pf1',
          underlying: 'SAP',
          descriptor: 'SAPQ6C200',
          strike: 200,
          expiry_date: '2026-08-21',
          quantity: 1,
          buyback_price: 10,
          currency: 'EUR',
          exchange_rate: 1,
          buyback_date: '2026-07-02',
          market_price: 15,
          market_price_updated_at: null,
          resold_quantity: 0,
          resell_price: null,
          resell_date: null,
          included_in_netting: true,
          manually_edited: false,
        },
      ];

      // USD: (50-40)*100*1/1.25 = 800; EUR: (15-10)*100*1/1 = 500 → 1300
      expect(openCallBuybacksGainLossEUR(rows, '2026-07-10')).toBeCloseTo(1300);
    });

    it('esclude le call scadute dal G/P (valore di mercato effettivo 0)', () => {
      const row = {
        id: 'buyback-1',
        portfolio_id: 'pf1',
        underlying: 'MU',
        descriptor: 'MUQ6C1100',
        strike: 1100,
        expiry_date: '2026-07-01',
        quantity: 1,
        buyback_price: 45.5,
        currency: 'USD',
        exchange_rate: 1,
        buyback_date: '2026-06-02',
        market_price: 50,
        market_price_updated_at: null,
        resold_quantity: 0,
        resell_price: null,
        resell_date: null,
        included_in_netting: true,
        manually_edited: false,
      } satisfies CallBuybackRow;

      // scaduta → mercato effettivo 0 → G/P = (0 - 45.5) * 100 * 1 = -4550
      expect(openCallBuybacksGainLossEUR([row], '2026-07-10')).toBeCloseTo(-4550);
    });
  });

  describe('included_in_netting: la deselezione esclude la riga dai totali', () => {
    const base = {
      id: 'b1',
      portfolio_id: 'pf1',
      underlying: 'MU',
      descriptor: 'MUQ6C1100',
      strike: 1100,
      expiry_date: '2026-08-21',
      quantity: 1,
      buyback_price: 40,
      currency: 'USD',
      exchange_rate: 1,
      buyback_date: '2026-07-02',
      market_price: 50,
      market_price_updated_at: null,
      resold_quantity: 0,
      resell_price: null,
      resell_date: null,
      manually_edited: false,
    };

    it('una riga esclusa non contribuisce né al premio né al G/P', () => {
      const included = { ...base, id: 'in', included_in_netting: true } satisfies CallBuybackRow;
      const excluded = { ...base, id: 'out', included_in_netting: false } satisfies CallBuybackRow;

      // Solo la riga inclusa conta: valore mercato 50*100*1/1 = 5000; G/P (50-40)*100 = 1000
      expect(openCallBuybacksValueEUR([included, excluded], '2026-07-10')).toBeCloseTo(5000);
      expect(openCallBuybacksGainLossEUR([included, excluded], '2026-07-10')).toBeCloseTo(1000);
    });

    it('tutte escluse → totali a zero', () => {
      const excluded = { ...base, included_in_netting: false } satisfies CallBuybackRow;
      expect(openCallBuybacksValueEUR([excluded], '2026-07-10')).toBe(0);
      expect(openCallBuybacksGainLossEUR([excluded], '2026-07-10')).toBe(0);
    });
  });

  it('ACQ che combacia solo con la firma di una config CC (posizione già sparita) → tracciato', () => {
    const trades = [
      trade({ descriptor: 'CEGU6C320', underlyingTicker: 'CEG', optionType: 'call', strike: 320, expiryDate: '2026-09-18', side: 'ACQ', contracts: 1, pricePerShare: 12.3 }),
    ];
    const configs = [ccConfig('CEG', 320, '2026-09-18')];

    const { buybacks } = extractCallBuybacks(trades, [], configs);
    expect(buybacks).toHaveLength(1);
    expect(buybacks[0].underlying).toBe('CEG');
  });

  it('ACQ di call MAI venduta (apertura LEAP, es. IREN del file reale) → NON è un riacquisto', () => {
    const trades = [
      trade({ descriptor: 'IRENF8C80', underlyingTicker: 'IREN', optionType: 'call', strike: 80, expiryDate: '2028-01-21', side: 'ACQ', contracts: 2, pricePerShare: 13.15 }),
    ];

    const { buybacks } = extractCallBuybacks(trades, [], []);
    expect(buybacks).toHaveLength(0);
  });

  it('le put sono ignorate (solo call da rivendere)', () => {
    const trades = [
      trade({ descriptor: 'MUQ6P900', underlyingTicker: 'MU', optionType: 'put', strike: 900, expiryDate: '2026-08-21', side: 'ACQ', contracts: 1, pricePerShare: 94 }),
    ];
    const { buybacks, resells } = extractCallBuybacks(trades, [soldCallPosition('MU', 1100, '2026-08-21')], []);
    expect(buybacks).toHaveLength(0);
    expect(resells).toHaveLength(0);
  });

  it('VEN dello stesso descrittore nello stesso file compensa il riacquisto (netting intra-file)', () => {
    const trades = [
      trade({ descriptor: 'MUQ6C1100', underlyingTicker: 'MU', optionType: 'call', strike: 1100, expiryDate: '2026-08-21', side: 'ACQ', contracts: 2, pricePerShare: 45.5, tradeDate: '2026-07-01' }),
      trade({ descriptor: 'MUQ6C1100', underlyingTicker: 'MU', optionType: 'call', strike: 1100, expiryDate: '2026-08-21', side: 'VEN', contracts: 1, pricePerShare: 50.0, tradeDate: '2026-07-02' }),
    ];
    const positions = [soldCallPosition('MU', 1100, '2026-08-21', -2)];

    const { buybacks, resells } = extractCallBuybacks(trades, positions, []);
    expect(buybacks).toHaveLength(1);
    expect(buybacks[0].quantity).toBe(1); // 2 riacquistate − 1 rivenduta
    expect(resells).toHaveLength(0); // interamente compensata intra-file
  });

  it('VEN senza riacquisto intra-file → rivendita da applicare ai buyback aperti nel DB', () => {
    const trades = [
      trade({ descriptor: 'MUQ6C1100', underlyingTicker: 'MU', optionType: 'call', strike: 1100, expiryDate: '2026-08-21', side: 'VEN', contracts: 1, pricePerShare: 52.0 }),
    ];
    const { buybacks, resells } = extractCallBuybacks(trades, [], []);
    expect(buybacks).toHaveLength(0);
    expect(resells).toHaveLength(1);
    expect(resells[0].descriptor).toBe('MUQ6C1100');
    expect(resells[0].resell_price).toBe(52);
  });
});

describe('tranche di riacquisto (più lotti a prezzi diversi)', () => {
  it('due ACQ dello stesso giorno a prezzi diversi restano tranche distinte', () => {
    const trades = [
      trade({ descriptor: 'MUQ6C1100', underlyingTicker: 'MU', optionType: 'call', strike: 1100, expiryDate: '2026-08-21', side: 'ACQ', contracts: 2, pricePerShare: 41.0, tradeDate: '2026-07-02' }),
      trade({ descriptor: 'MUQ6C1100', underlyingTicker: 'MU', optionType: 'call', strike: 1100, expiryDate: '2026-08-21', side: 'ACQ', contracts: 3, pricePerShare: 43.5, tradeDate: '2026-07-02' }),
    ];
    const positions = [soldCallPosition('MU', 1100, '2026-08-21', -5)];

    const merged = mergeIdenticalTranches(extractCallBuybacks(trades, positions, []).buybacks);
    expect(merged).toHaveLength(2);
    expect(merged.map(b => b.buyback_price).sort((a, b) => a - b)).toEqual([41.0, 43.5]);
    expect(merged.reduce((s, b) => s + b.quantity, 0)).toBe(5);
  });

  it('due ACQ identici (stessa data E stesso prezzo) si sommano in una riga sola', () => {
    const trades = [
      trade({ descriptor: 'MUQ6C1100', underlyingTicker: 'MU', optionType: 'call', strike: 1100, expiryDate: '2026-08-21', side: 'ACQ', contracts: 2, pricePerShare: 41.0, tradeDate: '2026-07-02' }),
      trade({ descriptor: 'MUQ6C1100', underlyingTicker: 'MU', optionType: 'call', strike: 1100, expiryDate: '2026-08-21', side: 'ACQ', contracts: 1, pricePerShare: 41.0, tradeDate: '2026-07-02' }),
    ];
    const positions = [soldCallPosition('MU', 1100, '2026-08-21', -3)];

    const merged = mergeIdenticalTranches(extractCallBuybacks(trades, positions, []).buybacks);
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(3);
  });

  it('trancheKey distingue i lotti per prezzo e non per quantità', () => {
    const a = trancheKey({ descriptor: 'MUQ6C1100', buyback_date: '2026-07-02', buyback_price: 41 });
    const b = trancheKey({ descriptor: 'MUQ6C1100', buyback_date: '2026-07-02', buyback_price: 43.5 });
    expect(a).not.toBe(b);
    expect(a).toBe(trancheKey({ descriptor: 'MUQ6C1100', buyback_date: '2026-07-02', buyback_price: 41 }));
  });
});

describe('residuo dei contratti disponibili', () => {
  it('scala i disponibili delle tranche già registrate fino a zero', () => {
    const items = [{ ticker: 'MU', availableContracts: 5 }, { ticker: 'BABA', availableContracts: 2 }];
    const out = computeAvailableCallResiduals(items, [
      { underlying: 'MU', quantity: 2 },
      { underlying: 'MU', quantity: 3 },
    ]);
    const mu = out.find(o => o.ticker === 'MU')!;
    expect(mu.registeredContracts).toBe(5);
    expect(mu.residualContracts).toBe(0);
    const baba = out.find(o => o.ticker === 'BABA')!;
    expect(baba.registeredContracts).toBe(0);
    expect(baba.residualContracts).toBe(2);
  });

  it('non scende mai sotto zero se i registrati eccedono i disponibili', () => {
    const out = computeAvailableCallResiduals(
      [{ ticker: 'MU', availableContracts: 1 }],
      [{ underlying: 'MU', quantity: 4 }],
    );
    expect(out[0].residualContracts).toBe(0);
    expect(out[0].registeredContracts).toBe(4);
  });

  it('un sottostante senza chiave valida non matcha tutto', () => {
    const out = computeAvailableCallResiduals(
      [{ ticker: 'MU', availableContracts: 3 }],
      [{ underlying: '', quantity: 2 }],
    );
    expect(out[0].residualContracts).toBe(3);
  });
});

describe('G/P potenziale con prezzo di mercato mancante', () => {
  const base: Omit<CallBuybackRow, 'market_price' | 'expiry_date'> = {
    id: 'r1',
    portfolio_id: 'p1',
    underlying: 'MU',
    descriptor: 'MUQ6C1100',
    strike: 1100,
    quantity: 2,
    buyback_price: 40,
    currency: 'USD',
    exchange_rate: 1,
    buyback_date: '2026-07-02',
    market_price_updated_at: null,
    resold_quantity: 0,
    resell_price: null,
    resell_date: null,
    included_in_netting: true,
    manually_edited: false,
  };
  const today = '2026-07-27';

  it('call viva senza market_price è esclusa dai totali (non vale −costo di riacquisto)', () => {
    const rows = [{ ...base, expiry_date: '2026-08-21', market_price: null }] as CallBuybackRow[];
    expect(hasKnownMarketPrice(rows[0], today)).toBe(false);
    expect(openCallBuybacksGainLossEUR(rows, today)).toBe(0);
    expect(openCallBuybacksValueEUR(rows, today)).toBe(0);
    expect(unknownMarketPriceCount(rows, today)).toBe(1);
  });

  it('call scaduta senza market_price vale zero per davvero: perdita piena', () => {
    const rows = [{ ...base, expiry_date: '2026-07-17', market_price: null }] as CallBuybackRow[];
    expect(hasKnownMarketPrice(rows[0], today)).toBe(true);
    expect(openCallBuybacksGainLossEUR(rows, today)).toBe(-8000); // −40 × 100 × 2
    expect(unknownMarketPriceCount(rows, today)).toBe(0);
  });

  it('prezzo di mercato noto sotto il riacquisto → G/P negativo reale', () => {
    const rows = [{ ...base, expiry_date: '2026-08-21', market_price: 35 }] as CallBuybackRow[];
    expect(openCallBuybacksGainLossEUR(rows, today)).toBe(-1000); // (35−40) × 100 × 2
  });

  it('tranche a prezzi diversi: ognuna col proprio G/P, sommato sul totale', () => {
    const rows = [
      { ...base, id: 'a', expiry_date: '2026-08-21', buyback_price: 41, quantity: 2, market_price: 45 },
      { ...base, id: 'b', expiry_date: '2026-08-21', buyback_price: 43.5, quantity: 3, market_price: 45 },
    ] as CallBuybackRow[];
    // (45−41)×100×2 = 800 ; (45−43.5)×100×3 = 450
    expect(openCallBuybacksGainLossEUR(rows, today)).toBeCloseTo(1250, 6);
  });
});
