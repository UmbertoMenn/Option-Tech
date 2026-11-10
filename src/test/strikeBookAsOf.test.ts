import { describe, it, expect } from 'vitest';
import { buildStrikeBook, chainForRoll } from '@/lib/strikeBookAsOf';

const ref = new Date('2026-10-27T16:00:00Z'); // data snapshot storico

describe('buildStrikeBook (catene alla data dello snapshot)', () => {
  it('include le scadenze oggi già passate ma vive alla data dello snapshot', () => {
    const b = buildStrikeBook(
      [
        { ticker: 'app', expiry: '2026-10-30', put_strikes: [240, 250, 260], as_of: '2026-10-29' },
        { ticker: 'APP', expiry: '2026-11-20', put_strikes: ['200', '220', '240'], as_of: '2026-10-27' },
        { ticker: 'APP', expiry: '2026-10-16', put_strikes: [200, 210], as_of: '2026-10-12' }, // scaduta allo snapshot
        { ticker: 'APP', expiry: '2026-12-18', put_strikes: [100], as_of: '2026-10-27' }, // catena inutilizzabile
      ],
      ref,
    );
    expect(b.APP.map((c) => c.exp)).toEqual(['2026-10-30', '2026-11-20']);
    expect(b.APP[1].strikes).toEqual([200, 220, 240]);
    expect(b.APP[1].asOf).toBe('2026-10-27');
  });

  it('senza versione (tabella corrente) asOf assente', () => {
    const b = buildStrikeBook([{ ticker: 'X', expiry: '2026-11-20', put_strikes: [10, 12] }], ref);
    expect(b.X[0].asOf).toBeUndefined();
  });
});

describe('chainForRoll', () => {
  it('trova la catena della scadenza di arrivo (±½ mese)', () => {
    const b = buildStrikeBook(
      [
        { ticker: 'APP', expiry: '2026-11-20', put_strikes: [200, 220], as_of: '2026-10-27' },
        { ticker: 'APP', expiry: '2026-12-18', put_strikes: [180, 200], as_of: '2026-11-03' },
      ],
      ref,
    );
    const dec = b.APP[1];
    expect(chainForRoll(b, 'app', dec.T + 0.01)?.asOf).toBe('2026-11-03');
    expect(chainForRoll(b, 'APP', 2)).toBeUndefined();
  });
});
