import { describe, it, expect } from 'vitest';
import {
  historicalConfigsEditedAt,
  replaceHistoricalConfigs,
  addHistoricalConfig,
  removeHistoricalConfig,
  cancelHistoricalOverride,
  configsToFreeze,
  HistoricalConfig,
} from '@/lib/historicalConfigEdit';

const PID = '6d84937c-4fdd-474d-89cf-717784aa1b8d';
let n = 0;
const id = () => `id-${++n}`;

// Snapshot andreaz 07/09/2026: naked put AVGO P360 set-26 congelata per 1 contratto, in portafoglio −2.
const frozen07Sep: HistoricalConfig[] = [
  {
    id: '7ba68e48', portfolio_id: PID, underlying: 'AVGO', strategy_type: 'naked_put',
    position_signatures: [{ option_type: 'put', strike: 360, expiry: '2026-09-18', quantity_sign: -1, quantity_abs: 1 }],
    is_synthetic: false, linked_stock_id: null, linked_stock_slot_ids: [], sort_order: 29, config_locked: false,
    override_canceled_at: null, created_at: '2026-09-07T12:27:02Z', updated_at: '2026-09-07T12:27:02Z',
  },
];

describe('correzione config di uno snapshot storico', () => {
  it('snapshot mai corretto: nessuna data di correzione', () => {
    expect(historicalConfigsEditedAt(frozen07Sep)).toBeNull();
  });

  it('wizard: sostituzione completa con la quantità corretta, marcata con la data', () => {
    const now = '2026-11-10T14:30:00.000Z';
    const out = replaceHistoricalConfigs(
      [{ ...frozen07Sep[0], position_signatures: [{ ...frozen07Sep[0].position_signatures[0], quantity_abs: 2 }] }],
      PID, now, id,
    );
    expect(out).toHaveLength(1);
    expect(out[0].position_signatures[0].quantity_abs).toBe(2);
    expect(out[0].portfolio_id).toBe(PID);
    expect(historicalConfigsEditedAt(out)).toBe(now);
  });

  it('aggiunta / rimozione / annullo override marcano tutto lo snapshot', () => {
    const t1 = '2026-11-10T14:00:00.000Z';
    const added = addHistoricalConfig(frozen07Sep, { underlying: 'WDC', strategy_type: 'naked_put', position_signatures: [] }, PID, t1, id);
    expect(added).toHaveLength(2);
    expect(added.every((c) => c.historical_edited_at === t1)).toBe(true);
    const t2 = '2026-11-10T15:00:00.000Z';
    const removed = removeHistoricalConfig(added, added[1].id, t2);
    expect(removed.map((c) => c.id)).toEqual(['7ba68e48']);
    expect(historicalConfigsEditedAt(removed)).toBe(t2);
    const locked = [{ ...frozen07Sep[0], config_locked: true }];
    const unl = cancelHistoricalOverride(locked, '7ba68e48', t2);
    expect(unl[0].config_locked).toBe(false);
    expect(unl[0].override_canceled_at).toBe(t2);
  });

  it('ricongelamento della data: la correzione non viene sovrascritta dalle config live', () => {
    const corrected = replaceHistoricalConfigs([frozen07Sep[0]], PID, '2026-11-10T14:30:00.000Z', id);
    const live = [{ id: 'live-1' }];
    expect(configsToFreeze(corrected, live)).toEqual(corrected);
    expect(configsToFreeze(frozen07Sep, live)).toBe(live); // mai corretto → config live come prima
    expect(configsToFreeze(null, live)).toBe(live);
  });
});
