import { describe, it, expect } from 'vitest';
import {
  applyStockTradesToBasis,
  applyOptionTradesToBasis,
  detectEarlyAssignments,
  unitCostWithCommission,
  optionUnitPremiumWithCommission,
  optionBasisKey,
  CostBasisEntry,
  PutPositionLite,
} from '@/lib/costBasis';
import { FlussiTitoliStockTrade, FlussiTitoliOptionTrade } from '@/lib/flussiCsvParser';

const stockKey = (t: FlussiTitoliStockTrade) => t.isin.toUpperCase();
const optionKey = (u: string) => u.toUpperCase();

function stock(partial: Partial<FlussiTitoliStockTrade>): FlussiTitoliStockTrade {
  return {
    accountId: 'ACC1',
    isin: 'US01609W1027', // BABA
    description: 'ALIBABA GROUP HOLDING LTD',
    side: 'ACQ',
    quantity: 100,
    price: 100,
    currency: 'USD',
    exchangeRate: 1,
    grossEUR: 10000,
    commission: 0,
    tradeDate: '2026-07-01',
    ...partial,
  };
}

function optionTrade(partial: Partial<FlussiTitoliOptionTrade>): FlussiTitoliOptionTrade {
  return {
    accountId: 'ACC1',
    descriptor: 'BABAU6P130',
    underlyingTicker: 'BABA',
    optionType: 'put',
    strike: 130,
    expiryDate: '2026-09-18',
    side: 'VEN',
    contracts: 1,
    pricePerShare: 3,
    currency: 'USD',
    exchangeRate: 1,
    grossEUR: 300,
    commission: 0,
    tradeDate: '2026-07-01',
    ...partial,
  };
}

describe('costBasis', () => {
  describe('media ponderata continua', () => {
    it('acquisto su titolo esistente ricalcola il PMC ponderato', () => {
      const existing: CostBasisEntry[] = [{
        basisKey: 'US01609W1027', isin: 'US01609W1027', description: 'BABA',
        pmc: 100, quantity: 200, currency: 'USD',
      }];
      const res = applyStockTradesToBasis(
        existing,
        [stock({ side: 'ACQ', quantity: 100, price: 130 })],
        [],
        stockKey,
      );
      const e = res.entries.get('US01609W1027')!;
      // (200×100 + 100×130) / 300 = 110
      expect(e.pmc).toBeCloseTo(110);
      expect(e.quantity).toBe(300);
    });

    it('vendita parziale riduce la quantità ma NON cambia il PMC', () => {
      const existing: CostBasisEntry[] = [{
        basisKey: 'US01609W1027', isin: 'US01609W1027', description: 'BABA',
        pmc: 110, quantity: 300, currency: 'USD',
      }];
      const res = applyStockTradesToBasis(
        existing,
        [stock({ side: 'VEN', quantity: 100, price: 150 })],
        [],
        stockKey,
      );
      const e = res.entries.get('US01609W1027')!;
      expect(e.pmc).toBeCloseTo(110);
      expect(e.quantity).toBe(200);
    });

    it('acquisto di titolo nuovo crea la voce con PMC = costo unitario', () => {
      const res = applyStockTradesToBasis(
        [],
        [stock({ side: 'ACQ', quantity: 50, price: 80 })],
        [],
        stockKey,
      );
      const e = res.entries.get('US01609W1027')!;
      expect(e.pmc).toBeCloseTo(80);
      expect(e.quantity).toBe(50);
    });

    it('le commissioni (EUR) entrano nel costo unitario convertite in divisa', () => {
      // 10 EUR di commissioni con cambio 1.2 USD/EUR su 100 azioni = +0.12 USD/azione
      const t = stock({ side: 'ACQ', quantity: 100, price: 100, commission: 10, exchangeRate: 1.2 });
      expect(unitCostWithCommission(t)).toBeCloseTo(100.12);
    });

    it('operazioni applicate in ordine di data', () => {
      const res = applyStockTradesToBasis(
        [],
        [
          stock({ side: 'VEN', quantity: 50, price: 140, tradeDate: '2026-07-03' }),
          stock({ side: 'ACQ', quantity: 100, price: 100, tradeDate: '2026-07-01' }),
        ],
        [],
        stockKey,
      );
      const e = res.entries.get('US01609W1027')!;
      expect(e.quantity).toBe(50);
      expect(e.pmc).toBeCloseTo(100);
      expect(res.warnings).toHaveLength(0);
    });

    it('vendita oltre la quantità tracciata: clamp a zero con warning', () => {
      const existing: CostBasisEntry[] = [{
        basisKey: 'US01609W1027', isin: 'US01609W1027', description: 'BABA',
        pmc: 100, quantity: 50, currency: 'USD',
      }];
      const res = applyStockTradesToBasis(
        existing,
        [stock({ side: 'VEN', quantity: 100, price: 140 })],
        [],
        stockKey,
      );
      expect(res.entries.get('US01609W1027')!.quantity).toBe(0);
      expect(res.warnings).toHaveLength(1);
    });
  });

  describe('assegnazione anticipata', () => {
    const oldPuts: PutPositionLite[] = [{
      underlyingKey: 'BABA', strike: 130, expiryDate: '2026-09-18', shortContracts: 1,
    }];

    it('rilevata: put sparita + vendita 100 azioni + nuova put venduta', () => {
      const assignments = detectEarlyAssignments(
        oldPuts,
        [], // la put non è più nel saldo aggiornato
        [stock({ side: 'VEN', quantity: 100, price: 120, tradeDate: '2026-07-10' })],
        [optionTrade({ side: 'VEN', strike: 120, expiryDate: '2026-12-18', descriptor: 'BABAX6P120' })],
        t => 'BABA', // il titolo risolve sulla stessa chiave del sottostante
        optionKey,
      );
      expect(assignments).toHaveLength(1);
      expect(assignments[0].shares).toBe(100);
      expect(assignments[0].strike).toBe(130);
    });

    it('NON rilevata se la put è stata ricomprata (ACQ) nei movimenti', () => {
      const assignments = detectEarlyAssignments(
        oldPuts,
        [],
        [stock({ side: 'VEN', quantity: 100, price: 120, tradeDate: '2026-07-10' })],
        [
          optionTrade({ side: 'ACQ', strike: 130, expiryDate: '2026-09-18' }), // riacquisto
          optionTrade({ side: 'VEN', strike: 120, expiryDate: '2026-12-18' }),
        ],
        () => 'BABA',
        optionKey,
      );
      expect(assignments).toHaveLength(0);
    });

    it('NON rilevata senza la vendita di una nuova put', () => {
      const assignments = detectEarlyAssignments(
        oldPuts,
        [],
        [stock({ side: 'VEN', quantity: 100, price: 120, tradeDate: '2026-07-10' })],
        [],
        () => 'BABA',
        optionKey,
      );
      expect(assignments).toHaveLength(0);
    });

    it('NON rilevata se la put è scaduta naturalmente prima dei movimenti', () => {
      const expired: PutPositionLite[] = [{
        underlyingKey: 'BABA', strike: 130, expiryDate: '2026-06-19', shortContracts: 1,
      }];
      const assignments = detectEarlyAssignments(
        expired,
        [],
        [stock({ side: 'VEN', quantity: 100, price: 120, tradeDate: '2026-07-10' })],
        [optionTrade({ side: 'VEN', strike: 120, expiryDate: '2026-12-18' })],
        () => 'BABA',
        optionKey,
      );
      expect(assignments).toHaveLength(0);
    });

    it('la vendita che chiude il lotto assegnato NON tocca PMC/quantità preesistenti', () => {
      const existing: CostBasisEntry[] = [{
        basisKey: 'BABA', isin: 'US01609W1027', description: 'BABA',
        pmc: 100, quantity: 200, currency: 'USD',
      }];
      const res = applyStockTradesToBasis(
        existing,
        [stock({ side: 'VEN', quantity: 100, price: 120 })],
        [{ underlyingKey: 'BABA', strike: 130, expiryDate: '2026-09-18', contracts: 1, shares: 100 }],
        () => 'BABA',
      );
      const e = res.entries.get('BABA')!;
      expect(e.pmc).toBeCloseTo(100);
      expect(e.quantity).toBe(200); // invariata: la vendita netta il lotto assegnato
      expect(res.assignmentCloses).toHaveLength(1);
      expect(res.normalTrades).toHaveLength(0);
    });

    it('vendita oltre il lotto assegnato: trattata come vendita normale', () => {
      const existing: CostBasisEntry[] = [{
        basisKey: 'BABA', isin: 'US01609W1027', description: 'BABA',
        pmc: 100, quantity: 300, currency: 'USD',
      }];
      const res = applyStockTradesToBasis(
        existing,
        [stock({ side: 'VEN', quantity: 200, price: 120 })], // 200 > 100 assegnate
        [{ underlyingKey: 'BABA', strike: 130, expiryDate: '2026-09-18', contracts: 1, shares: 100 }],
        () => 'BABA',
      );
      const e = res.entries.get('BABA')!;
      // La vendita eccede il lotto assegnato → vendita normale intera
      expect(e.quantity).toBe(100);
      expect(e.pmc).toBeCloseTo(100);
    });
  });

  describe('PMC opzioni (posizione firmata)', () => {
    const uKey = (u: string) => u.toUpperCase();
    const KEY = optionBasisKey('BABA', 'put', 130, '2026-09-18');

    it('vendita apre una posizione short con PMC = premio incassato', () => {
      const res = applyOptionTradesToBasis(
        [],
        [optionTrade({ side: 'VEN', contracts: 2, pricePerShare: 3.5 })],
        uKey,
      );
      const e = res.entries.get(KEY)!;
      expect(e.quantity).toBe(-2);
      expect(e.pmc).toBeCloseTo(3.5);
    });

    it('aumentare la short ricalcola la media del premio', () => {
      const res = applyOptionTradesToBasis(
        [],
        [
          optionTrade({ side: 'VEN', contracts: 1, pricePerShare: 3, tradeDate: '2026-07-01' }),
          optionTrade({ side: 'VEN', contracts: 1, pricePerShare: 5, tradeDate: '2026-07-02' }),
        ],
        uKey,
      );
      const e = res.entries.get(KEY)!;
      expect(e.quantity).toBe(-2);
      expect(e.pmc).toBeCloseTo(4); // (3+5)/2
    });

    it('riacquisto parziale della short riduce i contratti ma NON cambia il PMC', () => {
      const res = applyOptionTradesToBasis(
        [],
        [
          optionTrade({ side: 'VEN', contracts: 2, pricePerShare: 4, tradeDate: '2026-07-01' }),
          optionTrade({ side: 'ACQ', contracts: 1, pricePerShare: 6, tradeDate: '2026-07-02' }),
        ],
        uKey,
      );
      const e = res.entries.get(KEY)!;
      expect(e.quantity).toBe(-1);
      expect(e.pmc).toBeCloseTo(4);
    });

    it('acquisti long: media ponderata; vendita parziale non tocca il PMC', () => {
      const res = applyOptionTradesToBasis(
        [],
        [
          optionTrade({ side: 'ACQ', contracts: 1, pricePerShare: 10, tradeDate: '2026-07-01' }),
          optionTrade({ side: 'ACQ', contracts: 1, pricePerShare: 14, tradeDate: '2026-07-02' }),
          optionTrade({ side: 'VEN', contracts: 1, pricePerShare: 20, tradeDate: '2026-07-03' }),
        ],
        uKey,
      );
      const e = res.entries.get(KEY)!;
      expect(e.quantity).toBe(1);
      expect(e.pmc).toBeCloseTo(12); // (10+14)/2, la vendita non tocca la media
    });

    it('attraversamento dello zero: nuova posizione al premio del trade', () => {
      const res = applyOptionTradesToBasis(
        [],
        [
          optionTrade({ side: 'VEN', contracts: 1, pricePerShare: 4, tradeDate: '2026-07-01' }),
          optionTrade({ side: 'ACQ', contracts: 3, pricePerShare: 6, tradeDate: '2026-07-02' }),
        ],
        uKey,
      );
      const e = res.entries.get(KEY)!;
      expect(e.quantity).toBe(2); // -1 + 3
      expect(e.pmc).toBeCloseTo(6); // long nata al prezzo del trade
    });

    it('chiusura completa a zero: quantità 0, PMC conservato', () => {
      const res = applyOptionTradesToBasis(
        [],
        [
          optionTrade({ side: 'VEN', contracts: 2, pricePerShare: 4, tradeDate: '2026-07-01' }),
          optionTrade({ side: 'ACQ', contracts: 2, pricePerShare: 1, tradeDate: '2026-07-02' }),
        ],
        uKey,
      );
      const e = res.entries.get(KEY)!;
      expect(e.quantity).toBe(0);
      expect(e.pmc).toBeCloseTo(4);
    });

    it('le commissioni (EUR) entrano nel premio unitario convertite in divisa', () => {
      // 12 EUR con cambio 1.2 su 1 contratto (100 azioni) = +0.144 per azione
      const t = optionTrade({ contracts: 1, pricePerShare: 3, commission: 12, exchangeRate: 1.2 });
      expect(optionUnitPremiumWithCommission(t)).toBeCloseTo(3.144);
    });

    it('opzioni distinte (strike/scadenza/tipo) non si mescolano', () => {
      const res = applyOptionTradesToBasis(
        [],
        [
          optionTrade({ side: 'VEN', contracts: 1, pricePerShare: 3, strike: 130 }),
          optionTrade({ side: 'VEN', contracts: 1, pricePerShare: 7, strike: 150 }),
        ],
        uKey,
      );
      expect(res.entries.get(optionBasisKey('BABA', 'put', 130, '2026-09-18'))!.pmc).toBeCloseTo(3);
      expect(res.entries.get(optionBasisKey('BABA', 'put', 150, '2026-09-18'))!.pmc).toBeCloseTo(7);
    });

    it('non tocca le voci titoli esistenti nello store', () => {
      const existing: CostBasisEntry[] = [{
        basisKey: 'US01609W1027', isin: 'US01609W1027', description: 'BABA',
        pmc: 100, quantity: 200, currency: 'USD',
      }];
      const res = applyOptionTradesToBasis(
        existing,
        [optionTrade({ side: 'VEN', contracts: 1, pricePerShare: 3 })],
        uKey,
      );
      const stock = res.entries.get('US01609W1027')!;
      expect(stock.pmc).toBe(100);
      expect(stock.quantity).toBe(200);
      expect(res.entries.size).toBe(2);
    });
  });
});
