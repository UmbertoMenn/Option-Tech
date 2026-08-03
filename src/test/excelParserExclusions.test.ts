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

  it('usa il prezzo medio fiscale del vecchio Excel, non il prezzo medio di carico', () => {
    const rows = [
      ['AZIONI ED ETF'],
      ['ISIN', 'DESCRIZIONE', 'DIVISA', 'QUANTITA', 'PREZZO MEDIO CARICO', 'PREZZO MEDIO FISCALE', 'PREZZO VALORE', 'CONTROVALORE EUR'],
      ['US0378331005', 'APPLE INC', 'USD', 10, 301.54, 264.164, 333.43, 3334.3],
    ];

    const result = parsePortfolioData(rows);

    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].avg_cost).toBe(264.164);
  });

  it('legge anche il prezzo medio fiscale testuale nel formato italiano del vecchio Excel', () => {
    const rows = [
      ['AZIONI ED ETF'],
      ['ISIN', 'DESCRIZIONE', 'DIVISA', 'QUANTITA', 'PREZZO MEDIO CARICO', 'PREZZO MEDIO FISCALE', 'PREZZO VALORE', 'CONTROVALORE EUR'],
      ['US0378331005', 'APPLE INC', 'USD', 10, '1.185,25', '1.164,25', '1.210,00', '12.100,00'],
    ];

    const result = parsePortfolioData(rows);

    expect(result.positions[0].avg_cost).toBe(1164.25);
  });

  it('usa il prezzo medio fiscale anche per le opzioni del vecchio Excel', () => {
    const rows = [
      ['DERIVATI'],
      ['DESCRIZIONE ESTESA', 'DIVISA CODICE', 'QUANTITA', 'PREZZO MEDIO CARICO', 'PREZZO MEDIO FISCALE', 'PREZZO VALORE', 'CONTROVALORE EUR'],
      ['NVIDIA CORP OPTION CALL 200 DEC/25', 'USD', -1, 20, 33, 34, -3400],
    ];

    const result = parsePortfolioData(rows);

    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].asset_type).toBe('derivative');
    expect(result.positions[0].avg_cost).toBe(33);
  });

  it('mantiene il prezzo medio di carico delle opzioni quando il fiscale non è disponibile', () => {
    const rows = [
      ['DERIVATI ESTERO'],
      ['CODICE_VALORE', 'ISIN', 'DESCRIZIONE ESTESA', 'DIVISA CODICE', 'PREZZO VALORE', 'PREZZO MEDIO CARICO', 'PREZZO MEDIO FISCALE', 'QUANTITA', 'CONTROVALORE EUR'],
      ['', '', 'APPLE INC OPTION CALL 290 DEC/26', 'USD', '56,700', '22,750', '-', '-1,000', '-5.670,00'],
    ];

    const result = parsePortfolioData(rows);

    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].avg_cost).toBe(22.75);
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
