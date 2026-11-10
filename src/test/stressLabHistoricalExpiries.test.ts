/**
 * Visualizzazione Storica: con uno snapshot di mesi fa lo Stress Lab deve ragionare dalla
 * DATA DELLO SNAPSHOT. Le mensili comprese fra quella data e oggi (oggi scadute) devono
 * restare scadenze valide sia per le gambe sia come scadenze di arrivo del rolling, anche
 * se l'archivio delle catene di strike parte dopo (12/10/2026).
 * Dati reali: snapshot completo del 23/06/2026, put Vertiv K310 venduta, spot 318,32.
 */
import { describe, it, expect } from 'vitest';
import {
  runScenario,
  yearsToExpiry,
  impliedVolFromPrice,
  effIVMap,
  DEFAULT_ROLL_PARAMS,
  StressLeg,
  StressUnderlyingMap,
} from '@/lib/stressLab';
import { rolledExpiryISO } from '@/lib/stressLabExpiry';
import { buildStrikeBook } from '@/lib/strikeBookAsOf';

const SNAP = '2026-06-23';
const ref = new Date(SNAP + 'T16:00:00Z');
const TODAY = '2026-11-10';

function vrtLeg(): StressLeg {
  const S = 318.32;
  const K = 310;
  const px = 8.35;
  const exp = '2026-07-21';
  const T = yearsToExpiry(exp, ref);
  const iv = impliedVolFromPrice(px, S, K, T, 0.04, false);
  return { u: 'VRT', cp: 'P', K, T, exp, q: -1, px, fl: false, mult: 100, nm: 'VRT P310', iv, rollQ: -1 };
}

const unders: StressUnderlyingMap = { VRT: { S: 318.32, beta: 1 }, EURUSD: { S: 1.15, beta: 0 } };
const prmBase = { r: 0.04, skewB: -0.018, kappa: 0.6, pExp: 0.5, days: 0, fx: { USD: 1.15, HKD: 9 }, netting: false };

describe('Stress Lab su snapshot storico — scadenze fra la data snapshot e oggi', () => {
  it('la gamba con scadenza oggi passata ma viva allo snapshot è valutata (T > 0 dalla data snapshot)', () => {
    const l = vrtLeg();
    expect(yearsToExpiry(l.exp, new Date(TODAY + 'T16:00:00Z'))).toBeLessThanOrEqual(0); // scaduta oggi
    expect(l.T).toBeGreaterThan(0); // viva allo snapshot
    expect(Number.isFinite(l.iv)).toBe(true);
  });

  it('il rolling usa come arrivo le mensili successive alla data snapshot, anche se oggi scadute', () => {
    const legs = [vrtLeg()];
    // Archivio catene: solo scadenze da ottobre 2026 in poi (come in produzione).
    const strikes = buildStrikeBook(
      [{ ticker: 'VRT', expiry: '2026-11-20', put_strikes: [200, 220, 240, 250, 260, 270, 280, 290, 300], as_of: '2026-10-14' }],
      ref,
    );
    const res = runScenario(legs, [], unders, effIVMap(legs), -20, 15, {
      ...prmBase,
      roll: { ...DEFAULT_ROLL_PARAMS, maxMonthsForward: 12 },
      strikes,
    });
    const rolls = res.rows[0].rolls ?? [];
    expect(rolls.length).toBeGreaterThan(0);
    const first = rolls[0];
    const firstExp = rolledExpiryISO(legs[0].exp, first.fromT, first.toT);
    // Prima scadenza di arrivo: la mensile più vicina che dà la discesa minima a credito
    // (settembre 2026: agosto non basta) — futura rispetto allo snapshot, oggi già scaduta.
    expect(firstExp).toBe('2026-09-18');
    expect(firstExp! > SNAP && firstExp! < TODAY).toBe(true);
    // Le scadenze successive si concatenano dalla scadenza di arrivo precedente.
    let exp = legs[0].exp;
    for (const e of rolls) {
      const next = rolledExpiryISO(exp, e.fromT, e.toT)!;
      expect(next > exp).toBe(true);
      exp = next;
    }
    // Nessuna catena archiviata per agosto: strike dal passo della catena più vicina, mai saltata la scadenza.
    expect(['passo', 'regola']).toContain(first.kSrc);
  });
});
