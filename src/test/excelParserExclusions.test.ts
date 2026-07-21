import { describe, expect, it } from 'vitest';
import { parsePortfolioData } from '@/lib/excelParser';

describe('parsePortfolioData exclusions', () => {
  it('esclude una posizione per descrizione esatta normalizzata', () => {
    const rows = [
      ['AZIONI ED ETF'],
      ['ISIN', 'DESCRIZIONE', 'DIVISA', 'QUANTITA', 'VALORIZZAZIONE EUR'],
      ['IT0005056236', ' BIO   ON ', 'EUR', 10, 2704],
      ['US0378331005', 'APPLE INC', 'USD', 10, 2000],
    ];

    const result = parsePortfolioData(rows, {
      excludedPositionDescriptions: ['BIO ON'],
    });

    expect(result.positions.map(position => position.description)).toEqual(['APPLE INC']);
  });

  it('esclude una posizione per ISIN indipendentemente dalla descrizione', () => {
    const rows = [
      ['AZIONI ED ETF'],
      ['ISIN', 'DESCRIZIONE', 'DIVISA', 'QUANTITA', 'VALORIZZAZIONE EUR'],
      ['IT0005056236', 'BIO-ON SPA AZ ORD', 'EUR', 10, 2704],
      ['US0378331005', 'APPLE INC', 'USD', 10, 2000],
    ];

    const result = parsePortfolioData(rows, {
      excludedPositionIsins: ['IT0005056236'],
    });

    expect(result.positions.map(position => position.description)).toEqual(['APPLE INC']);
    expect(result.positionsSnapshotPresent).toBe(true);
  });

  it('mantiene il PMC presente nel vecchio Excel', () => {
    const rows = [
      ['AZIONI ED ETF'],
      ['ISIN', 'DESCRIZIONE', 'DIVISA', 'QUANTITA', 'PREZZO MEDIO CARICO', 'PREZZO VALORE', 'CONTROVALORE EUR'],
      ['US0378331005', 'APPLE INC', 'USD', 10, 185.25, 210, 2100],
    ];

    const result = parsePortfolioData(rows);

    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].avg_cost).toBe(185.25);
  });

  it('legge anche il PMC testuale nel formato italiano del vecchio Excel', () => {
    const rows = [
      ['AZIONI ED ETF'],
      ['ISIN', 'DESCRIZIONE', 'DIVISA', 'QUANTITA', 'PREZZO MEDIO CARICO', 'PREZZO VALORE', 'CONTROVALORE EUR'],
      ['US0378331005', 'APPLE INC', 'USD', 10, '1.185,25', '1.210,00', '12.100,00'],
    ];

    const result = parsePortfolioData(rows);

    expect(result.positions[0].avg_cost).toBe(1185.25);
  });

  it('applica al vecchio Excel le esclusioni configurate sui conti liquidità', () => {
    const rows = [
      ['LIQUIDITA'],
      ['CONTO', 'VALORIZZAZIONE EUR'],
      ['00000000452', 1000],
      ['00000000123', 2500],
    ];

    const result = parsePortfolioData(rows, {
      excludedCashPatterns: [{ last: '452' }],
    });

    expect(result.cashValue).toBe(2500);
    expect(result.cashAccounts).toEqual([{ accountId: '00000000123', value: 2500 }]);
  });
});
