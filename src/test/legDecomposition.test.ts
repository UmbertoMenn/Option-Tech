import { describe, it, expect } from 'vitest';
import {
  computeLegDecomposition,
  computeSinglePortfolioNetting,
} from '@/hooks/useDerivativeNetting';
import { Position } from '@/types/portfolio';
import { StrategyConfiguration, PositionSignature } from '@/hooks/useStrategyConfigurations';
import { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';

function pos(p: Partial<Position>): Position {
  return {
    id: Math.random().toString(36).slice(2),
    portfolio_id: 'pf1',
    isin: null, ticker: null, description: '', asset_type: 'derivative',
    currency: 'USD', exchange_rate: 1, quantity: 0,
    current_price: null, avg_cost: null, market_value: null,
    profit_loss: null, profit_loss_pct: null, weight_pct: null,
    option_type: null, strike_price: null, expiry_date: null, underlying: null,
    snapshot_price: null, snapshot_market_value: null,
    created_at: '', updated_at: '',
    ...p,
  };
}

function cfg(c: Partial<StrategyConfiguration>): StrategyConfiguration {
  return {
    id: Math.random().toString(36).slice(2), portfolio_id: 'pf1', underlying: 'CEG',
    strategy_type: 'covered_call', position_signatures: [],
    is_synthetic: false, linked_stock_id: null, linked_stock_slot_ids: [],
    sort_order: 0, config_locked: true, override_canceled_at: null, created_at: '', updated_at: '',
    ...c,
  };
}

function sig(s: Partial<PositionSignature> & { option_type: string; strike: number; expiry: string; quantity_sign: number }): PositionSignature {
  return { quantity_abs: 1, ...s };
}

const up = (price: number): UnderlyingPrice => ({ price, currency: 'USD' });

/**
 * Scenario multi-strategia che esercita:
 *  - Covered Call con short CALL ITM (intrinseco + time value)
 *  - Naked Put con short PUT ITM (intrinseco) e short PUT OTM (esclusa)
 *  - gamba orfana long CALL (MTM pieno, posizione lunga)
 */
function buildScenario() {
  const EXP = '2026-12-18';

  // Covered Call: azioni CEG + short call K280 (spot 300 → ITM)
  const cegStock = pos({ asset_type: 'stock', ticker: 'CEG', description: 'CONSTELLATION ENERGY', quantity: 100, current_price: 300 });
  const cegShortCall = pos({ option_type: 'call', quantity: -1, strike_price: 280, expiry_date: EXP, underlying: 'CEG', ticker: 'CEG', snapshot_price: 25 });
  const ccConfig = cfg({
    strategy_type: 'covered_call', underlying: 'CEG',
    linked_stock_id: cegStock.id, linked_stock_slot_ids: [cegStock.id],
    position_signatures: [sig({ option_type: 'call', strike: 280, expiry: EXP, quantity_sign: -1 })],
  });

  // Naked Put su NVDA (spot 90): short put K100 ITM + short put K70 OTM
  const nvdaPutItm = pos({ option_type: 'put', quantity: -1, strike_price: 100, expiry_date: EXP, underlying: 'NVDA', ticker: 'NVDA', snapshot_price: 15 });
  const nvdaPutOtm = pos({ option_type: 'put', quantity: -1, strike_price: 70, expiry_date: EXP, underlying: 'NVDA', ticker: 'NVDA', snapshot_price: 3 });
  const npConfig = cfg({
    strategy_type: 'naked_put', underlying: 'NVDA',
    position_signatures: [
      sig({ option_type: 'put', strike: 100, expiry: EXP, quantity_sign: -1 }),
      sig({ option_type: 'put', strike: 70, expiry: EXP, quantity_sign: -1 }),
    ],
  });

  // Orfana: long CALL CEG K350 (spot 300 → OTM), nessuna config
  const cegLongCall = pos({ option_type: 'call', quantity: 1, strike_price: 350, expiry_date: EXP, underlying: 'CEG', ticker: 'CEG', snapshot_price: 4 });

  const positions = [cegStock, cegShortCall, nvdaPutItm, nvdaPutOtm, cegLongCall];
  const configs = [ccConfig, npConfig];
  const prices: Record<string, UnderlyingPrice> = { CEG: up(300), NVDA: up(90) };

  return { positions, configs, prices, ids: { cegShortCall: cegShortCall.id, nvdaPutItm: nvdaPutItm.id, nvdaPutOtm: nvdaPutOtm.id, cegLongCall: cegLongCall.id } };
}

describe('computeLegDecomposition — riconciliazione con computeSinglePortfolioNetting', () => {
  it('netting_total: Σ contrib = totalNetting e per-riga intrinseco + time value = contributo', () => {
    const { positions, configs, prices } = buildScenario();
    const netting = computeSinglePortfolioNetting(positions, [], prices, configs);
    const rows = computeLegDecomposition('netting_total', positions, [], prices, configs);

    const sumContrib = rows.reduce((s, r) => s + r.contribEUR, 0);
    expect(sumContrib).toBeCloseTo(netting.totalNetting, 6);

    for (const r of rows) {
      expect(r.intrinsicCountedEUR + r.timeValueCountedEUR).toBeCloseTo(r.contribEUR, 6);
      // In vista totale nessuna gamba è valutata a solo intrinseco e nulla è escluso
      expect(r.atIntrinsic).toBe(false);
      expect(r.timeValueExcludedEUR).toBeCloseTo(0, 6);
      expect(r.contribEUR).toBeCloseTo(r.marketValueEUR, 6);
    }
  });

  it('netting_intrinsic_b: Σ contrib = nettingIntrinsicB', () => {
    const { positions, configs, prices } = buildScenario();
    const netting = computeSinglePortfolioNetting(positions, [], prices, configs);
    const rows = computeLegDecomposition('netting_intrinsic_b', positions, [], prices, configs);

    const sumContrib = rows.reduce((s, r) => s + r.contribEUR, 0);
    expect(sumContrib).toBeCloseTo(netting.nettingIntrinsicB, 6);
    // −2000 (short CALL ITM) − 1000 (short PUT ITM) + 0 (short PUT OTM) + 400 (long CALL a MTM, vista B)
    expect(sumContrib).toBeCloseTo(-2600, 6);
  });

  it('netting_intrinsic_a: Σ contrib = nettingIntrinsicA', () => {
    const { positions, configs, prices } = buildScenario();
    const netting = computeSinglePortfolioNetting(positions, [], prices, configs);
    const rows = computeLegDecomposition('netting_intrinsic_a', positions, [], prices, configs);

    const sumContrib = rows.reduce((s, r) => s + r.contribEUR, 0);
    expect(sumContrib).toBeCloseTo(netting.nettingIntrinsicA, 6);
    // come B ma la long CALL OTM vale 0 anziché MTM +400 (vista A: comprate anch'esse a intrinseco)
    expect(sumContrib).toBeCloseTo(-3000, 6);
  });

  it('netting_intrinsic_b: short CALL ITM valutata a solo intrinseco, time value escluso', () => {
    const { positions, configs, prices, ids } = buildScenario();
    const rows = computeLegDecomposition('netting_intrinsic_b', positions, [], prices, configs);
    const r = rows.find(x => x.positionId === ids.cegShortCall)!;
    expect(r).toBeTruthy();
    expect(r.atIntrinsic).toBe(true);
    expect(r.isOTM).toBe(false);
    // intrinseco: (300 − 280) × 1 × 100 = 2000, corto → −2000
    expect(r.intrinsicCountedEUR).toBeCloseTo(-2000, 6);
    expect(r.timeValueCountedEUR).toBeCloseTo(0, 6);
    // MTM −2500 → time value escluso −500
    expect(r.marketValueEUR).toBeCloseTo(-2500, 6);
    expect(r.timeValueExcludedEUR).toBeCloseTo(-500, 6);
    expect(r.contribEUR).toBeCloseTo(-2000, 6);
  });

  it('netting_intrinsic_b: short PUT OTM esclusa integralmente (contributo 0)', () => {
    const { positions, configs, prices, ids } = buildScenario();
    const rows = computeLegDecomposition('netting_intrinsic_b', positions, [], prices, configs);
    const r = rows.find(x => x.positionId === ids.nvdaPutOtm)!;
    expect(r).toBeTruthy();
    expect(r.atIntrinsic).toBe(true);
    expect(r.isOTM).toBe(true);
    expect(r.intrinsicCountedEUR).toBeCloseTo(0, 6);
    expect(r.timeValueCountedEUR).toBeCloseTo(0, 6);
    expect(r.contribEUR).toBeCloseTo(0, 6);
    // tutto il MTM (−300) è time value escluso
    expect(r.timeValueExcludedEUR).toBeCloseTo(-300, 6);
  });

  it('netting_intrinsic_b: gamba long CALL a MTM pieno (comprate a valore di mercato)', () => {
    const { positions, configs, prices, ids } = buildScenario();
    const rows = computeLegDecomposition('netting_intrinsic_b', positions, [], prices, configs);
    const r = rows.find(x => x.positionId === ids.cegLongCall)!;
    expect(r).toBeTruthy();
    expect(r.atIntrinsic).toBe(false);
    expect(r.intrinsicCountedEUR).toBeCloseTo(0, 6); // K350 con spot 300 → OTM
    expect(r.timeValueCountedEUR).toBeCloseTo(400, 6);
    expect(r.contribEUR).toBeCloseTo(400, 6);
  });

  it('netting_intrinsic_a: long CALL OTM esclusa (contributo 0), long ITM a +intrinseco', () => {
    const { positions, configs, prices, ids } = buildScenario();
    const rows = computeLegDecomposition('netting_intrinsic_a', positions, [], prices, configs);

    // long CALL K350, spot 300 → OTM: contributo 0, tutto MTM è time value escluso
    const otm = rows.find(x => x.positionId === ids.cegLongCall)!;
    expect(otm.atIntrinsic).toBe(true);
    expect(otm.isOTM).toBe(true);
    expect(otm.contribEUR).toBeCloseTo(0, 6);
    expect(otm.timeValueExcludedEUR).toBeCloseTo(400, 6);
  });

  it('netting_intrinsic_a: long PUT ITM valutata a +intrinseco, time value escluso', () => {
    const { positions, configs, prices } = buildScenario();
    const EXP = '2026-12-18';
    const longPut = pos({ option_type: 'put', quantity: 1, strike_price: 120, expiry_date: EXP, underlying: 'NVDA', ticker: 'NVDA', snapshot_price: 32 });
    const all = [...positions, longPut];
    const rows = computeLegDecomposition('netting_intrinsic_a', all, [], prices, configs);
    const r = rows.find(x => x.positionId === longPut.id)!;
    expect(r).toBeTruthy();
    expect(r.atIntrinsic).toBe(true);
    expect(r.isOTM).toBe(false);
    // intrinseco (120 − 90) × 1 × 100 = 3000, MTM 3200 → time value escluso 200
    expect(r.intrinsicCountedEUR).toBeCloseTo(3000, 6);
    expect(r.contribEUR).toBeCloseTo(3000, 6);
    expect(r.timeValueExcludedEUR).toBeCloseTo(200, 6);

    // riconciliazione col netting A
    const netting = computeSinglePortfolioNetting(all, [], prices, configs);
    const sumContrib = rows.reduce((s, x) => s + x.contribEUR, 0);
    expect(sumContrib).toBeCloseTo(netting.nettingIntrinsicA, 6);
  });
});
