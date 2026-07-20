import { describe, it, expect } from 'vitest';
import {
  detectExpiryAssignments,
  applyExpiryAssignmentToStore,
  PutPositionLite,
} from '@/lib/costBasis';

const fullKey = (u: string, s: number, e: string) => `${u}|${s}|${e}`;

describe('detectExpiryAssignments — assegnazione put a scadenza (no movimenti)', () => {
  const snapshotDate = '2026-07-17';

  it('MRVL: put short 230 sparita a scadenza + 200 azioni apparse → 1 assegnazione @ strike 230', () => {
    const oldShortPuts: PutPositionLite[] = [
      { underlyingKey: 'MRVL', strike: 230, expiryDate: '2026-07-17', shortContracts: 2 },
    ];
    const r = detectExpiryAssignments({
      oldShortPuts,
      newShortPutFullKeys: new Set(),
      snapshotDate,
      stockQuantityDeltaByUnderlyingKey: new Map([['MRVL', 200]]),
    });
    expect(r.assignments).toHaveLength(1);
    expect(r.assignments[0]).toMatchObject({ underlyingKey: 'MRVL', strike: 230, contracts: 2, shares: 200 });
    expect(r.warnings).toHaveLength(0);
  });

  it('RKLB: put short 120 sparita a scadenza + 100 azioni apparse → 1 assegnazione @ strike 120', () => {
    const r = detectExpiryAssignments({
      oldShortPuts: [{ underlyingKey: 'RKLB', strike: 120, expiryDate: '2026-07-17', shortContracts: 1 }],
      newShortPutFullKeys: new Set(),
      snapshotDate,
      stockQuantityDeltaByUnderlyingKey: new Map([['RKLB', 100]]),
    });
    expect(r.assignments).toHaveLength(1);
    expect(r.assignments[0].strike).toBe(120);
    expect(r.assignments[0].shares).toBe(100);
  });

  it('put ancora presente nel nuovo snapshot: nessuna assegnazione', () => {
    const oldShortPuts: PutPositionLite[] = [
      { underlyingKey: 'MRVL', strike: 230, expiryDate: '2026-07-17', shortContracts: 2 },
    ];
    const r = detectExpiryAssignments({
      oldShortPuts,
      newShortPutFullKeys: new Set([fullKey('MRVL', 230, '2026-07-17')]),
      snapshotDate,
      stockQuantityDeltaByUnderlyingKey: new Map([['MRVL', 200]]),
    });
    expect(r.assignments).toHaveLength(0);
  });

  it('put non ancora scaduta alla data snapshot: nessuna assegnazione', () => {
    const r = detectExpiryAssignments({
      oldShortPuts: [{ underlyingKey: 'MRVL', strike: 230, expiryDate: '2026-08-21', shortContracts: 2 }],
      newShortPutFullKeys: new Set(),
      snapshotDate,
      stockQuantityDeltaByUnderlyingKey: new Map([['MRVL', 200]]),
    });
    expect(r.assignments).toHaveLength(0);
  });

  it('azioni apparse insufficienti rispetto ai contratti sparici: nessuna assegnazione + warning', () => {
    const r = detectExpiryAssignments({
      oldShortPuts: [{ underlyingKey: 'MRVL', strike: 230, expiryDate: '2026-07-17', shortContracts: 2 }],
      newShortPutFullKeys: new Set(),
      snapshotDate,
      stockQuantityDeltaByUnderlyingKey: new Map([['MRVL', 100]]), // servivano 200
    });
    expect(r.assignments).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/non coerente/);
    expect(r.warnings[0]).toContain('attese 200');
    expect(r.warnings[0]).toContain('trovate 100');
  });

  it('delta eccessivo (acquisto indipendente nello stesso upload): nessuna assegnazione + warning', () => {
    const r = detectExpiryAssignments({
      oldShortPuts: [{ underlyingKey: 'MRVL', strike: 230, expiryDate: '2026-07-17', shortContracts: 2 }],
      newShortPutFullKeys: new Set(),
      snapshotDate,
      stockQuantityDeltaByUnderlyingKey: new Map([['MRVL', 350]]), // 200 attesi + 150 acquisto
    });
    expect(r.assignments).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/non coerente/);
    expect(r.warnings[0]).toContain('trovate 350');
  });

  it('delta esatto: assegnazione riconosciuta', () => {
    const r = detectExpiryAssignments({
      oldShortPuts: [{ underlyingKey: 'MRVL', strike: 230, expiryDate: '2026-07-17', shortContracts: 2 }],
      newShortPutFullKeys: new Set(),
      snapshotDate,
      stockQuantityDeltaByUnderlyingKey: new Map([['MRVL', 200]]),
    });
    expect(r.assignments).toHaveLength(1);
    expect(r.warnings).toHaveLength(0);
  });

  it('più put stesso strike sparite: aggregate in una assegnazione unica', () => {
    const r = detectExpiryAssignments({
      oldShortPuts: [
        { underlyingKey: 'XYZ', strike: 50, expiryDate: '2026-07-17', shortContracts: 1 },
        { underlyingKey: 'XYZ', strike: 50, expiryDate: '2026-07-17', shortContracts: 2 },
      ],
      newShortPutFullKeys: new Set(),
      snapshotDate,
      stockQuantityDeltaByUnderlyingKey: new Map([['XYZ', 300]]),
    });
    expect(r.assignments).toHaveLength(1);
    expect(r.assignments[0]).toMatchObject({ strike: 50, contracts: 3, shares: 300 });
  });

  it('put a strike diversi sparite sullo stesso sottostante: warning e nessuna assegnazione', () => {
    const r = detectExpiryAssignments({
      oldShortPuts: [
        { underlyingKey: 'XYZ', strike: 50, expiryDate: '2026-07-17', shortContracts: 1 },
        { underlyingKey: 'XYZ', strike: 60, expiryDate: '2026-07-17', shortContracts: 1 },
      ],
      newShortPutFullKeys: new Set(),
      snapshotDate,
      stockQuantityDeltaByUnderlyingKey: new Map([['XYZ', 200]]),
    });
    expect(r.assignments).toHaveLength(0);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('ambigua');
    expect(r.warnings[0]).toContain('50, 60');
  });

  it('conteggio Δ azioni preesistenti considera solo l\'incremento', () => {
    // Preesistenti 100 → nuove 300 → Δ = 200 → basta per 2 contratti
    const r = detectExpiryAssignments({
      oldShortPuts: [{ underlyingKey: 'MRVL', strike: 230, expiryDate: '2026-07-17', shortContracts: 2 }],
      newShortPutFullKeys: new Set(),
      snapshotDate,
      stockQuantityDeltaByUnderlyingKey: new Map([['MRVL', 200]]),
    });
    expect(r.assignments).toHaveLength(1);
  });
});
