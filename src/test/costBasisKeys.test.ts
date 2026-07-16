import { describe, it, expect } from 'vitest';
import { positionBasisKey, derivativeBasisKey } from '@/lib/costBasisStore';
import { buildDynamicAliasMap } from '@/lib/tickerIdentity';
import { ParsedPosition } from '@/lib/flussiCsvParser';

// Righe reali di underlying_mappings: sottostanti assenti dalla mappa statica.
const aliases = buildDynamicAliasMap([
  { underlying: 'UBER TECHNOLOGIES INC', ticker: 'UBER' },
  { underlying: 'UBER TECHNOLOGIES', ticker: 'UBER' },
  { underlying: 'MARVELL TECHNOLOGY', ticker: 'MRVL' },
  { underlying: 'ROCKET LAB CORP', ticker: 'RKLB' },
  { underlying: 'ROCKET LAB', ticker: 'RKLB' },
]);

function optPos(partial: Partial<ParsedPosition>): ParsedPosition {
  return {
    description: '',
    asset_type: 'derivative',
    currency: 'USD',
    quantity: -1,
    option_type: 'call',
    strike_price: 80,
    expiry_date: '2026-08-21',
    ...partial,
  } as ParsedPosition;
}

describe('derivativeBasisKey — sottostante fuori dalla mappa statica', () => {
  it('REGRESSIONE: senza alias dinamici ripiega su NAME: e la chiave è instabile', () => {
    const key = derivativeBasisKey(
      optPos({ underlying: 'UBER TECHNOLOGIES', description: 'UBER TECHNOLOGIES INC OPTION CALL 80 AUG/26' }),
    );
    expect(key).toContain('NAME:');
  });

  it('con gli alias dinamici risolve sul ticker canonico', () => {
    const key = derivativeBasisKey(
      optPos({ underlying: 'UBER TECHNOLOGIES', description: 'UBER TECHNOLOGIES INC OPTION CALL 80 AUG/26' }),
      aliases,
    );
    expect(key).toBe('OPT:UBER:C:80:2026-08-21');
  });

  it("la chiave da Excel e quella dai movimenti coincidono", () => {
    // Excel: descrizione lunga della banca
    const fromExcel = derivativeBasisKey(
      optPos({
        underlying: 'MARVELL TECHNOLOGY',
        description: 'Marvell Technology Inc OPTION PUT 230 JUL/26',
        option_type: 'put',
        strike_price: 230,
        expiry_date: '2026-07-17',
      }),
      aliases,
    );
    // Movimenti: ticker dal descrittore dell'opzione
    const fromMovements = derivativeBasisKey(
      optPos({
        underlying: 'MRVL',
        description: 'MRVLS6P230',
        option_type: 'put',
        strike_price: 230,
        expiry_date: '2026-07-17',
      }),
      aliases,
    );
    expect(fromExcel).toBe('OPT:MRVL:P:230:2026-07-17');
    expect(fromMovements).toBe(fromExcel);
  });

  it('Rocket Lab: descrizioni diverse, stessa chiave', () => {
    const a = derivativeBasisKey(
      optPos({ underlying: 'ROCKET LAB', description: 'Rocket Lab Corp OPTION PUT 70 AUG/26', option_type: 'put', strike_price: 70 }),
      aliases,
    );
    const b = derivativeBasisKey(
      optPos({ underlying: 'RKLB', description: 'RKLBT6P70', option_type: 'put', strike_price: 70 }),
      aliases,
    );
    expect(a).toBe('OPT:RKLB:P:70:2026-08-21');
    expect(b).toBe(a);
  });

  it('sottostante già nella mappa statica: invariato', () => {
    const key = derivativeBasisKey(
      optPos({ underlying: 'AAPL', description: 'APPLE COMPUTER, INC. OPTION CALL 290 DEC/26', strike_price: 290, expiry_date: '2026-12-18' }),
      aliases,
    );
    expect(key).toBe('OPT:AAPL:C:290:2026-12-18');
  });

  it('campi opzione mancanti -> null', () => {
    expect(derivativeBasisKey(optPos({ option_type: undefined }), aliases)).toBeNull();
  });
});

describe('positionBasisKey', () => {
  it("l'ISIN vince sempre e non dipende dagli alias", () => {
    const p = { isin: 'us01609w1027', ticker: 'BABA', description: 'ALIBABA' } as ParsedPosition;
    expect(positionBasisKey(p)).toBe('US01609W1027');
    expect(positionBasisKey(p, aliases)).toBe('US01609W1027');
  });

  it('senza ISIN usa gli alias dinamici', () => {
    const p = { isin: null, ticker: null, description: 'UBER TECHNOLOGIES INC' } as unknown as ParsedPosition;
    expect(positionBasisKey(p, aliases)).toBe('UBER');
  });
});
