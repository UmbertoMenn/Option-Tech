import { describe, it, expect } from 'vitest';
import { parseBondPartial, resolveBond } from '@/lib/bondMath';

// Helper: (anno, meseIndex 0-based)
function ym(d: Date | null): [number, number] | null {
  return d ? [d.getUTCFullYear(), d.getUTCMonth()] : null;
}

/**
 * Fixture prese 1:1 dalle description reali in produzione (tabella positions,
 * asset_type='bond'). Prima della riscrittura del parser la maggior parte di queste
 * NON veniva risolta (scadenza null) pur avendo la data nella description → il bond
 * ricompariva "non risolto" ad ogni import. Questi test provano il bug e la fix.
 */
describe('resolver bond — scadenza da description reale', () => {
  const cases: Array<{ d: string; y: number; m: number; note: string }> = [
    { d: 'BOT ANNUALE 12/02/27', y: 2027, m: 1, note: 'DD/MM/YY (anno 2 cifre)' },
    { d: 'BOT ANNUALE 14/04/27', y: 2027, m: 3, note: 'DD/MM/YY' },
    { d: 'BOT ANNUALE 14/12/2026', y: 2026, m: 11, note: 'DD/MM/YYYY' },
    { d: 'BTP 01/02/2028 2%', y: 2028, m: 1, note: 'DD/MM/YYYY + cedola' },
    { d: 'BTP 01/03/32 1.65%', y: 2032, m: 2, note: 'DD/MM/YY + cedola' },
    { d: 'BON Y OBL 0.10% 31', y: 2031, m: 11, note: 'anno nudo 2 cifre a fine stringa' },
    { d: 'BUNDESREP 0.25% 28', y: 2028, m: 11, note: 'anno nudo 2 cifre' },
    { d: 'FRANCE GOVT 0% 30', y: 2030, m: 11, note: 'anno nudo 2 cifre, cedola 0%' },
    { d: 'ROMANIA 2.375% 27', y: 2027, m: 11, note: 'anno nudo dopo cedola con decimali' },
    { d: 'BTP ITA 140328 INFLC', y: 2028, m: 2, note: 'DDMMYY concatenato' },
    { d: 'BTP ITA 221128 INFL', y: 2028, m: 10, note: 'DDMMYY concatenato' },
    { d: 'BTP ITA 280630 INF C', y: 2030, m: 5, note: 'DDMMYY concatenato' },
    { d: 'BTP PIU 33 OPZ.PUT', y: 2033, m: 11, note: 'anno nudo 2 cifre BTP Più' },
    { d: 'BTP VAL 050330 ST UP', y: 2030, m: 2, note: 'DDMMYY BTP Valore step-up' },
    { d: 'BTP VAL 130627 ST UP', y: 2027, m: 5, note: 'DDMMYY' },
    { d: 'BTP VAL 281032 ST UP', y: 2032, m: 9, note: 'DDMMYY' },
    { d: 'BOT ZC APR27 A EUR', y: 2027, m: 3, note: 'mese EN 3 lettere + YY' },
    { d: 'BANCA IFIS FX 5.5% FEB29 CALL EUR', y: 2029, m: 1, note: 'mese 3 lettere' },
    { d: 'IMA FR APR29 CALL EUR', y: 2029, m: 3, note: 'mese 3 lettere, cedola assente' },
    { d: 'OB.BANCO BPM TM EUR 14GIU28 CALL', y: 2028, m: 5, note: 'mese IT 3 lettere GIU' },
    { d: 'OB.BARCLAYS BK 5.3% EUR 16OTT42 CALL', y: 2042, m: 9, note: 'mese IT 3 lettere OTT' },
    { d: 'OB.BAT NETHERLANDS 5.375% EUR 16FEB31MWC', y: 2031, m: 1, note: 'mese glued a codice trailing' },
    { d: 'OB.FIBERCOP FX 6.875% EUR 15FEB28 MWC', y: 2028, m: 1, note: 'mese 3 lettere' },
    { d: 'ROMANIA 5.5% EUR 18SET28', y: 2028, m: 8, note: 'mese IT 3 lettere SET' },
    { d: 'SAN DONATO FX 6.5% OCT31 CALL EUR', y: 2031, m: 9, note: 'mese EN OCT + YY' },
    { d: 'ROMANIA TF 2,375% AP27 EUR', y: 2027, m: 3, note: 'mese IT 2 lettere AP' },
    { d: 'BTP 01/09/2033 2.45%', y: 2033, m: 8, note: 'DD/MM/YYYY' },
    { d: 'BON Y OBL 0.10% 31', y: 2031, m: 11, note: 'ripetuto (idempotenza)' },
  ];

  for (const c of cases) {
    it(`"${c.d}" → ${c.y}-${String(c.m + 1).padStart(2, '0')} (${c.note})`, () => {
      const p = parseBondPartial(c.d);
      expect(p.maturity, `scadenza non risolta per "${c.d}"`).not.toBeNull();
      expect(ym(p.maturity)).toEqual([c.y, c.m]);
    });
  }
});

describe('resolver bond — cedola da description reale', () => {
  it('cedola con punto', () => expect(parseBondPartial('BTP 01/03/32 1.65%').couponRatePct).toBeCloseTo(1.65));
  it('cedola con virgola', () => expect(parseBondPartial('ROMANIA TF 2,375% AP27 EUR').couponRatePct).toBeCloseTo(2.375));
  it('cedola 0% esplicita', () => expect(parseBondPartial('FRANCE GOVT 0% 30').couponRatePct).toBe(0));
  it('BOT → zero coupon (cedola 0 nota)', () => {
    const p = parseBondPartial('BOT ANNUALE 12/02/27');
    expect(p.couponRatePct).toBe(0);
    expect(p.zeroCoupon).toBe(true);
    expect(p.frequency).toBe(0);
  });
  it('corporate senza % → cedola non deducibile (null)', () => {
    expect(parseBondPartial('IMA FR APR29 CALL EUR').couponRatePct).toBeNull();
    expect(parseBondPartial('OB.BANCO BPM TM EUR 14GIU28 CALL').couponRatePct).toBeNull();
  });
  it('non confonde le cifre della cedola con l\'anno', () => {
    // "0.10%" contiene "10": non deve diventare 2010; l'anno è 31.
    expect(ym(parseBondPartial('BON Y OBL 0.10% 31').maturity)).toEqual([2031, 11]);
  });
});

describe('resolver bond — tipo (inflazione / step-up / ZC)', () => {
  it('BTP Italia → inflation-linked (anche con INFLC / INF C / solo "BTP ITA")', () => {
    expect(parseBondPartial('BTP ITA 140328 INFLC').inflationLinked).toBe(true);
    expect(parseBondPartial('BTP ITA 280630 INF C').inflationLinked).toBe(true);
    expect(parseBondPartial('BTP ITA 221128 INFL').inflationLinked).toBe(true);
  });
  it('BTP Valore / Più → step-up', () => {
    expect(parseBondPartial('BTP VAL 050330 ST UP').stepUp).toBe(true);
    expect(parseBondPartial('BTP PIU 33 OPZ.PUT').stepUp).toBe(true);
  });
  it('BTP govvie normale NON è inflazione né step-up', () => {
    const p = parseBondPartial('BTP 01/09/2033 2.45%');
    expect(p.inflationLinked).toBe(false);
    expect(p.stepUp).toBe(false);
    expect(p.frequency).toBe(2);
  });
});

describe('resolveBond — classificazione needsFix', () => {
  it('bond ordinario con cedola+scadenza → risolto, non da fixare', () => {
    const r = resolveBond('BTP 01/09/2033 2.45%');
    expect(r.status).toBe('resolved');
    expect(r.needsFix).toBe(false);
  });
  it('BOT ZC → risolto (non da fixare) anche senza %', () => {
    const r = resolveBond('BOT ANNUALE 12/02/27');
    expect(r.needsFix).toBe(false);
    expect(r.zeroCoupon).toBe(true);
  });
  it('BTP Italia → risolto via inflazione, non da fixare', () => {
    const r = resolveBond('BTP ITA 280630 INF C');
    expect(r.needsFix).toBe(false);
    expect(r.inflationLinked).toBe(true);
  });
  it('BTP Valore step-up → risolto (pull-to-par), non da fixare', () => {
    const r = resolveBond('BTP VAL 050330 ST UP');
    expect(r.needsFix).toBe(false);
    expect(r.stepUp).toBe(true);
  });
  it('corporate senza cedola nella description → partial, DA fixare', () => {
    const r = resolveBond('IMA FR APR29 CALL EUR');
    expect(r.status).toBe('partial');
    expect(r.needsFix).toBe(true);
    expect(r.maturity).not.toBeNull(); // la scadenza c\'è, manca solo la cedola
  });
  it('description senza data → unresolved, DA fixare', () => {
    const r = resolveBond('OBBLIGAZIONE STRANA SENZA DATI');
    expect(r.status).toBe('unresolved');
    expect(r.needsFix).toBe(true);
  });
  it('override manuale vince sulla description (scadenza + cedola)', () => {
    const r = resolveBond('OB.BANCO BPM TM EUR 14GIU28 CALL', {
      couponRatePct: 3.5, maturity: new Date(Date.UTC(2028, 5, 14)), frequency: 2,
    });
    expect(r.needsFix).toBe(false);
    expect(r.couponRatePct).toBe(3.5);
    expect(r.overridden).toBe(true);
    expect(r.frequency).toBe(2);
  });
  it('override con cedola null esplicita (solo scadenza) su corporate → resta partial', () => {
    const r = resolveBond('IMA FR APR29 CALL EUR', {
      couponRatePct: null, maturity: new Date(Date.UTC(2029, 3, 1)), frequency: 1,
    });
    expect(r.status).toBe('partial');
  });
});

describe('resolveBond — nessun falso positivo mese dentro i nomi emittente', () => {
  it('"OBBLIGAZIONE STRANA SENZA DATI" non estrae mese/anno spurio', () => {
    // "STRANA" contiene "ST" (settembre) ma non seguito da cifre → nessun match.
    expect(parseBondPartial('OBBLIGAZIONE STRANA SENZA DATI').maturity).toBeNull();
  });
});
