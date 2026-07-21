import { describe, expect, it } from 'vitest';
import { CallPositionLite, detectEarlyCallAssignments } from '@/lib/costBasis';

const oldCalls: CallPositionLite[] = [{
  underlyingKey: 'AAPL', strike: 200, expiryDate: '2026-09-18', shortContracts: 1,
}];

describe('detectEarlyCallAssignments — covered call richiamata (via movimenti)', () => {
  it('rilevata: call sparita + calo 100 azioni non spiegato da VEN', () => {
    const r = detectEarlyCallAssignments({
      oldShortCalls: oldCalls,
      newShortCallFullKeys: new Set(),                 // la call non è più nel saldo
      callBuybackFullKeys: new Set(),
      unexplainedShareDropByUnderlyingKey: new Map([['AAPL', 100]]),
    });
    expect(r.assignments).toHaveLength(1);
    expect(r.assignments[0].shares).toBe(100);
    expect(r.assignments[0].strike).toBe(200);
    expect(r.warnings).toHaveLength(0);
  });

  it('NON rilevata se la call è ancora nel saldo aggiornato', () => {
    const r = detectEarlyCallAssignments({
      oldShortCalls: oldCalls,
      newShortCallFullKeys: new Set(['AAPL|200|2026-09-18']),
      callBuybackFullKeys: new Set(),
      unexplainedShareDropByUnderlyingKey: new Map([['AAPL', 100]]),
    });
    expect(r.assignments).toHaveLength(0);
  });

  it('NON rilevata se la call è stata ricomprata (ACQ)', () => {
    const r = detectEarlyCallAssignments({
      oldShortCalls: oldCalls,
      newShortCallFullKeys: new Set(),
      callBuybackFullKeys: new Set(['AAPL|200|2026-09-18']),
      unexplainedShareDropByUnderlyingKey: new Map([['AAPL', 100]]),
    });
    expect(r.assignments).toHaveLength(0);
  });

  it('NON rilevata se le azioni non sono uscite (call OTM: drop ≤ 0)', () => {
    const r = detectEarlyCallAssignments({
      oldShortCalls: oldCalls,
      newShortCallFullKeys: new Set(),
      callBuybackFullKeys: new Set(),
      unexplainedShareDropByUnderlyingKey: new Map([['AAPL', 0]]),
    });
    expect(r.assignments).toHaveLength(0);
  });

  it('NON rilevata se il calo è spiegato da una VEN (unexplained < atteso) → warning', () => {
    // Le azioni sono scese di 100 ma tutte spiegate da una vendita: unexplained = 0
    // resta però un residuo parziale (es. 40) che non combacia con 100 → warning, niente assegnazione.
    const r = detectEarlyCallAssignments({
      oldShortCalls: oldCalls,
      newShortCallFullKeys: new Set(),
      callBuybackFullKeys: new Set(),
      unexplainedShareDropByUnderlyingKey: new Map([['AAPL', 40]]),
    });
    expect(r.assignments).toHaveLength(0);
    expect(r.warnings[0]).toContain('non coerente');
  });

  it('due contratti: rileva 200 azioni richiamate', () => {
    const r = detectEarlyCallAssignments({
      oldShortCalls: [{ underlyingKey: 'AAPL', strike: 200, expiryDate: '2026-09-18', shortContracts: 2 }],
      newShortCallFullKeys: new Set(),
      callBuybackFullKeys: new Set(),
      unexplainedShareDropByUnderlyingKey: new Map([['AAPL', 200]]),
    });
    expect(r.assignments).toHaveLength(1);
    expect(r.assignments[0].contracts).toBe(2);
    expect(r.assignments[0].shares).toBe(200);
  });

  it('strike diversi sullo stesso sottostante → ambigua, warning e nessun aggiornamento', () => {
    const r = detectEarlyCallAssignments({
      oldShortCalls: [
        { underlyingKey: 'AAPL', strike: 200, expiryDate: '2026-09-18', shortContracts: 1 },
        { underlyingKey: 'AAPL', strike: 210, expiryDate: '2026-09-18', shortContracts: 1 },
      ],
      newShortCallFullKeys: new Set(),
      callBuybackFullKeys: new Set(),
      unexplainedShareDropByUnderlyingKey: new Map([['AAPL', 200]]),
    });
    expect(r.assignments).toHaveLength(0);
    expect(r.warnings[0]).toContain('ambigua');
  });
});
