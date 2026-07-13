import { describe, expect, it } from 'vitest';
import { parsePortfolioData } from '@/lib/excelParser';

describe('parsePortfolioData exclusions', () => {
  it('esclude una posizione per descrizione esatta normalizzata', () => {
    const rows = [
      ['AZIONI ED ETF'],
      ['ISIN', 'DESCRIZIONE', 'DIVISA', 'QUANTITA', 'VALORIZZAZIONE EUR'],
      ['US09075V1026', ' BION   ON ', 'USD', 10, 2704],
      ['US0378331005', 'APPLE INC', 'USD', 10, 2000],
    ];

    const result = parsePortfolioData(rows, {
      excludedPositionDescriptions: ['BION ON'],
    });

    expect(result.positions.map(position => position.description)).toEqual(['APPLE INC']);
  });

  it('esclude una posizione per ISIN indipendentemente dalla descrizione', () => {
    const rows = [
      ['AZIONI ED ETF'],
      ['ISIN', 'DESCRIZIONE', 'DIVISA', 'QUANTITA', 'VALORIZZAZIONE EUR'],
      ['US09075V1026', 'BION BIOTECH CLASS A', 'USD', 10, 2704],
      ['US0378331005', 'APPLE INC', 'USD', 10, 2000],
    ];

    const result = parsePortfolioData(rows, {
      excludedPositionIsins: ['US09075V1026'],
    });

    expect(result.positions.map(position => position.description)).toEqual(['APPLE INC']);
  });
});
