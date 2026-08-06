import { describe, it, expect } from 'vitest';
import {
  BuybackTranche,
  CallBuybackAlertConfig,
  DEFAULT_CALL_BUYBACK_GAIN_THRESHOLD_PCT,
  callKey,
  evaluateCallBuybackAlerts,
  evaluateGain,
  formatCallBuybackAlertMessage,
  groupTranchesByCall,
  isMarketPriceKnown,
  isPriceThresholdTriggered,
  triggeredDirection,
  weightedAverageBuybackPrice,
} from '@/lib/callBuybackAlerts';

const TODAY = '2026-07-31';

function tranche(p: Partial<BuybackTranche> & { id: string }): BuybackTranche {
  return {
    underlying: 'AMZN',
    strike: 290,
    expiry_date: '2028-01-21',
    quantity: 2,
    buyback_price: 40,
    market_price: 50,
    ...p,
  };
}

function config(p: Partial<CallBuybackAlertConfig> & { id: string }): CallBuybackAlertConfig {
  return {
    portfolio_id: 'pf1',
    scope: 'call',
    buyback_id: null,
    underlying: 'AMZN',
    strike: 290,
    expiry_date: '2028-01-21',
    gain_threshold_pct: null,
    loss_threshold_pct: null,
    enabled: true,
    cooldown_minutes: 480,
    ...p,
  };
}

describe('media ponderata e G/P%', () => {
  it('pondera i prezzi di riacquisto per quantità, non per numero di tranche', () => {
    const rows = [
      tranche({ id: 'a', quantity: 1, buyback_price: 40 }),
      tranche({ id: 'b', quantity: 3, buyback_price: 44 }),
    ];
    // (40×1 + 44×3) / 4 = 43, non la media semplice 42
    expect(weightedAverageBuybackPrice(rows)).toBe(43);
  });

  it('ignora le tranche già chiuse (quantità zero)', () => {
    const rows = [
      tranche({ id: 'a', quantity: 0, buyback_price: 10 }),
      tranche({ id: 'b', quantity: 2, buyback_price: 40 }),
    ];
    expect(weightedAverageBuybackPrice(rows)).toBe(40);
  });

  it('G/P% è calcolato sul premio pagato', () => {
    const ev = evaluateGain([tranche({ id: 'a', buyback_price: 40, market_price: 50 })], TODAY);
    expect(ev?.gainPct).toBeCloseTo(25, 6); // (50−40)/40
    expect(ev?.referencePrice).toBe(40);
    expect(ev?.quantity).toBe(2);
  });

  it('sull’aggregato usa la media ponderata come riferimento', () => {
    const ev = evaluateGain([
      tranche({ id: 'a', quantity: 1, buyback_price: 40, market_price: 50 }),
      tranche({ id: 'b', quantity: 3, buyback_price: 44, market_price: 50 }),
    ], TODAY);
    expect(ev?.referencePrice).toBe(43);
    expect(ev?.gainPct).toBeCloseTo(((50 - 43) / 43) * 100, 6);
    expect(ev?.quantity).toBe(4);
  });

  it('call viva senza prezzo di mercato non è valutabile', () => {
    const row = tranche({ id: 'a', market_price: null });
    expect(isMarketPriceKnown(row, TODAY)).toBe(false);
    expect(evaluateGain([row], TODAY)).toBeNull();
  });

  it('call scaduta vale zero: G/P = −100%', () => {
    const row = tranche({ id: 'a', expiry_date: '2026-07-17', market_price: null });
    expect(isMarketPriceKnown(row, TODAY)).toBe(true);
    expect(evaluateGain([row], TODAY)?.gainPct).toBeCloseTo(-100, 6);
  });

  it('premio di riacquisto nullo non produce una percentuale', () => {
    expect(evaluateGain([tranche({ id: 'a', buyback_price: 0 })], TODAY)).toBeNull();
  });

  it('una sola tranche non valutabile blocca l’intero aggregato', () => {
    const rows = [
      tranche({ id: 'a', market_price: 50 }),
      tranche({ id: 'b', market_price: null }),
    ];
    expect(evaluateGain(rows, TODAY)).toBeNull();
  });
});

describe('direzioni indipendenti', () => {
  it('il default call da rivendere scatta a +20% dal prezzo di riacquisto', () => {
    expect(DEFAULT_CALL_BUYBACK_GAIN_THRESHOLD_PCT).toBe(20);
    const ev = evaluateGain([tranche({ id: 'default', buyback_price: 40, market_price: 48 })], TODAY);
    expect(ev?.gainPct).toBeCloseTo(DEFAULT_CALL_BUYBACK_GAIN_THRESHOLD_PCT, 6);
    expect(triggeredDirection(ev!.gainPct, DEFAULT_CALL_BUYBACK_GAIN_THRESHOLD_PCT, null)).toBe('gain');
  });

  it('scatta il guadagno al raggiungimento della soglia', () => {
    expect(triggeredDirection(25, 20, null)).toBe('gain');
    expect(triggeredDirection(20, 20, null)).toBe('gain'); // soglia inclusiva
    expect(triggeredDirection(19.9, 20, null)).toBeNull();
  });

  it('scatta la perdita sotto la soglia negativa', () => {
    expect(triggeredDirection(-15, null, 15)).toBe('loss');
    expect(triggeredDirection(-14.9, null, 15)).toBeNull();
  });

  it('una direzione non impostata non scatta mai', () => {
    expect(triggeredDirection(-80, 20, null)).toBeNull();
    expect(triggeredDirection(200, null, 15)).toBeNull();
  });

  it('le due soglie convivono senza interferire', () => {
    expect(triggeredDirection(30, 20, 15)).toBe('gain');
    expect(triggeredDirection(-30, 20, 15)).toBe('loss');
    expect(triggeredDirection(5, 20, 15)).toBeNull();
  });
});

describe('soglia sul prezzo del sottostante', () => {
  it('scatta sopra e sotto includendo esattamente il prezzo target', () => {
    expect(isPriceThresholdTriggered(250, 'above', 250)).toBe(true);
    expect(isPriceThresholdTriggered(249.99, 'above', 250)).toBe(false);
    expect(isPriceThresholdTriggered(250, 'below', 250)).toBe(true);
    expect(isPriceThresholdTriggered(250.01, 'below', 250)).toBe(false);
  });

  it('rifiuta prezzi o target non positivi', () => {
    expect(isPriceThresholdTriggered(0, 'above', 250)).toBe(false);
    expect(isPriceThresholdTriggered(250, 'above', 0)).toBe(false);
    expect(isPriceThresholdTriggered(Number.NaN, 'below', 250)).toBe(false);
  });

  it('una config prezzo non viene valutata come G/P del premio', () => {
    const out = evaluateCallBuybackAlerts(
      [config({
        id: 'price',
        scope: 'tranche',
        buyback_id: 't1',
        alert_mode: 'price',
        price_direction: 'above',
        price_target: 250,
      })],
      [tranche({ id: 't1', market_price: 1_000 })],
      TODAY,
    );
    expect(out).toHaveLength(0);
  });
});

describe('valutazione end-to-end delle config', () => {
  const tranches = [
    tranche({ id: 't1', quantity: 1, buyback_price: 40, market_price: 50 }),
    tranche({ id: 't2', quantity: 3, buyback_price: 44, market_price: 50 }),
    tranche({ id: 'other', underlying: 'MU', strike: 1100, expiry_date: '2026-08-21', quantity: 2, buyback_price: 45, market_price: 20 }),
  ];

  it('scope tranche valuta il singolo lotto col suo prezzo', () => {
    const out = evaluateCallBuybackAlerts(
      [config({ id: 'c1', scope: 'tranche', buyback_id: 't1', gain_threshold_pct: 20 })],
      tranches,
      TODAY,
    );
    expect(out).toHaveLength(1);
    expect(out[0].evaluation.referencePrice).toBe(40);
    expect(out[0].evaluation.gainPct).toBeCloseTo(25, 6);
    expect(out[0].direction).toBe('gain');
    expect(out[0].thresholdValue).toBe(20);
  });

  it('scope call aggrega tutte le tranche della stessa call', () => {
    const out = evaluateCallBuybackAlerts(
      [config({ id: 'c2', scope: 'call', gain_threshold_pct: 15 })],
      tranches,
      TODAY,
    );
    expect(out).toHaveLength(1);
    expect(out[0].evaluation.referencePrice).toBe(43);
    expect(out[0].evaluation.quantity).toBe(4);
  });

  it('la stessa call può avere config di tranche E di call: due avvisi separati', () => {
    const out = evaluateCallBuybackAlerts(
      [
        config({ id: 'c1', scope: 'tranche', buyback_id: 't1', gain_threshold_pct: 20 }),
        config({ id: 'c2', scope: 'call', gain_threshold_pct: 15 }),
      ],
      tranches,
      TODAY,
    );
    expect(out).toHaveLength(2);
    expect(out.map(o => o.config.id).sort()).toEqual(['c1', 'c2']);
  });

  it('config disabilitata non viene valutata', () => {
    const out = evaluateCallBuybackAlerts(
      [config({ id: 'c1', scope: 'call', gain_threshold_pct: 1, enabled: false })],
      tranches,
      TODAY,
    );
    expect(out).toHaveLength(0);
  });

  it('config di tranche il cui lotto non è più aperto viene ignorata', () => {
    const out = evaluateCallBuybackAlerts(
      [config({ id: 'c1', scope: 'tranche', buyback_id: 'sparito', gain_threshold_pct: 1 })],
      tranches,
      TODAY,
    );
    expect(out).toHaveLength(0);
  });

  it('la perdita scatta sulla call MU crollata', () => {
    const out = evaluateCallBuybackAlerts(
      [config({ id: 'c3', scope: 'call', underlying: 'MU', strike: 1100, expiry_date: '2026-08-21', loss_threshold_pct: 30 })],
      tranches,
      TODAY,
    );
    expect(out).toHaveLength(1);
    expect(out[0].direction).toBe('loss');
    expect(out[0].thresholdValue).toBe(-30);
    expect(out[0].evaluation.gainPct).toBeCloseTo(((20 - 45) / 45) * 100, 6);
  });

  it('nessuna soglia superata → nessun avviso', () => {
    const out = evaluateCallBuybackAlerts(
      [config({ id: 'c1', scope: 'call', gain_threshold_pct: 500, loss_threshold_pct: 90 })],
      tranches,
      TODAY,
    );
    expect(out).toHaveLength(0);
  });
});

describe('raggruppamento e chiavi', () => {
  it('la chiave di call è insensibile al case del sottostante', () => {
    expect(callKey({ underlying: 'amzn', strike: 290, expiry_date: '2028-01-21' }))
      .toBe(callKey({ underlying: 'AMZN', strike: 290, expiry_date: '2028-01-21' }));
  });

  it('strike o scadenza diversi sono call diverse', () => {
    const groups = groupTranchesByCall([
      tranche({ id: 'a', strike: 290 }),
      tranche({ id: 'b', strike: 300 }),
      tranche({ id: 'c', strike: 290, expiry_date: '2027-01-15' }),
    ]);
    expect(groups.size).toBe(3);
  });

  it('le tranche chiuse non formano gruppi', () => {
    const groups = groupTranchesByCall([tranche({ id: 'a', quantity: 0 })]);
    expect(groups.size).toBe(0);
  });
});

describe('messaggio', () => {
  it('distingue tranche e aggregato e riporta la percentuale in valore assoluto', () => {
    const [gain] = evaluateCallBuybackAlerts(
      [config({ id: 'c1', scope: 'tranche', buyback_id: 't1', gain_threshold_pct: 20 })],
      [tranche({ id: 't1', quantity: 2, buyback_price: 40, market_price: 50 })],
      TODAY,
    );
    const msg = formatCallBuybackAlertMessage(gain);
    expect(msg).toContain('guadagna il 25.0%');
    expect(msg).toContain('tranche da 2');
    expect(msg).not.toContain('-');
  });
});
