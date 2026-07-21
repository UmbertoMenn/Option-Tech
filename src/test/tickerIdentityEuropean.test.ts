import { describe, it, expect } from 'vitest';
import {
  buildDynamicAliasMap,
  canonicalizeTargetTicker,
  getCanonicalTickerKey,
  resolveUnderlyingIdentity,
} from '@/lib/tickerIdentity';

// Riproduce i dati reali di produzione (maxb / andreaz) che facevano risultare
// le covered call europee come scoperte o con ticker sbagliato.
describe('Riconciliazione titoli europei — azione ↔ opzione', () => {
  describe('canonicalizeTargetTicker: porta i target sporchi in forma canonica', () => {
    it('toglie i suffissi di borsa', () => {
      expect(canonicalizeTargetTicker('RACE.MI')).toBe('RACE');
      expect(canonicalizeTargetTicker('MBG.DE')).toBe('MBG');
      expect(canonicalizeTargetTicker('DHL.DE')).toBe('DPW');
      expect(canonicalizeTargetTicker('SAP.DE')).toBe('SAP');
    });
    it('collassa gli ADR noti', () => {
      expect(canonicalizeTargetTicker('MBGYY')).toBe('MBG');
    });
    it('è un no-op sui ticker US', () => {
      expect(canonicalizeTargetTicker('AAPL')).toBe('AAPL');
      expect(canonicalizeTargetTicker('NVDA')).toBe('NVDA');
    });
    it('lascia invariato un codice sconosciuto', () => {
      expect(canonicalizeTargetTicker('AIOT')).toBe('AIOT');
    });
  });

  describe('Ferrari: azione RACE.MI (→ RACE) e call codice RAC', () => {
    it('azione Ferrari NV → RACE (via ISIN e via ticker di borsa)', () => {
      expect(getCanonicalTickerKey({ rawTicker: 'RACE.MI', description: 'FERRARI NV', isin: 'NL0011585146' })).toBe('RACE');
    });
    it('PROVA DEL BUG: senza mappatura, il codice opzione "RAC" NON combacia con RACE', () => {
      expect(getCanonicalTickerKey({ rawTicker: 'RAC', underlyingName: 'RAC' })).toBe('RAC');
    });
    it('con la riga dinamica RAC → RACE, la call si riconcilia con l’azione', () => {
      const dyn = buildDynamicAliasMap([{ underlying: 'RAC', ticker: 'RACE' }]);
      const optionKey = getCanonicalTickerKey({ rawTicker: 'RAC', underlyingName: 'RAC' }, { dynamicAliases: dyn });
      const stockKey = getCanonicalTickerKey({ rawTicker: 'RACE.MI', description: 'FERRARI NV', isin: 'NL0011585146' }, { dynamicAliases: dyn });
      expect(optionKey).toBe('RACE');
      expect(stockKey).toBe('RACE');
      expect(optionKey).toBe(stockKey);
    });
  });

  describe('Mercedes: azione ISIN DE0007100000 (→ MBG) e call codice DAI', () => {
    it('azione → MBG via ISIN', () => {
      expect(getCanonicalTickerKey({ description: 'MERCEDES-BENZ GROUP', isin: 'DE0007100000' })).toBe('MBG');
    });
    it('call "DAI" → MBG (alias statico), non l’ADR MBGYY', () => {
      // Anche con una riga dinamica sbagliata DAI → MBGYY, l’alias statico vince
      // e il target sporco viene comunque canonicalizzato a MBG.
      const dyn = buildDynamicAliasMap([{ underlying: 'DAI', ticker: 'MBGYY' }]);
      expect(dyn.get('DAI')).toBe('MBG'); // target canonicalizzato in fase di build
      expect(getCanonicalTickerKey({ rawTicker: 'DAI', underlyingName: 'DAI' }, { dynamicAliases: dyn })).toBe('MBG');
    });
  });

  describe('mappe dinamiche con target suffissato ora combaciano con l’azione', () => {
    it('FERRARI NV → RACE.MI in mappa produce comunque la chiave RACE', () => {
      const dyn = buildDynamicAliasMap([{ underlying: 'FERRARI NV', ticker: 'RACE.MI' }]);
      expect(getCanonicalTickerKey({ underlyingName: 'FERRARI NV' }, { dynamicAliases: dyn })).toBe('RACE');
    });
    it('la guardia impedisce a una riga sbagliata di riscrivere un ticker canonico', () => {
      const dyn = buildDynamicAliasMap([{ underlying: 'NOW', ticker: 'SNOW' }]);
      // NOW è canonico (ServiceNow): la riga incoerente viene ignorata.
      expect(dyn.has('NOW')).toBe(false);
    });
  });
});
