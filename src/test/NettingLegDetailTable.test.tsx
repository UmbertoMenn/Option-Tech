import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NettingLegDetailTable } from '@/components/dashboard/NettingLegDetailTable';
import type { LegDecompositionRow } from '@/hooks/useDerivativeNetting';

afterEach(cleanup);

function leg(id: string, type: 'put' | 'call', intr: number, tv: number, excluded = 0): LegDecompositionRow {
  return {
    positionId: id, category: 'other', ticker: id, optionType: type,
    strike: 100, expiry: '2026-12-18', quantity: intr < 0 ? -1 : 1,
    spot: 110, optionPrice: 12, exchangeRate: 1,
    intrinsicCountedEUR: intr, timeValueCountedEUR: tv, timeValueExcludedEUR: excluded,
    contribEUR: intr + tv, marketValueEUR: intr + tv + excluded,
    atIntrinsic: excluded !== 0, isOTM: false,
  };
}

const rows = [leg('PUT-SHORT', 'put', -1000, -200), leg('PUT-LONG', 'put', 400, 50), leg('CALL', 'call', -2000, -300)];

function expectTotals(intr: string, tv: string, total: string) {
  // ICU versions differ on grouping four-digit Italian amounts.
  const normalize = (value: string) => value.replace(/\./g, '');
  const footer = screen.getByRole('table').querySelector('tfoot')!;
  const values = within(footer).getAllByRole('cell').slice(1).map((el) =>
    normalize(el.childNodes[0]?.textContent ?? ''),
  );
  expect(values).toEqual([intr, tv, total].map(normalize));
}

describe('NettingLegDetailTable: subtotali per tipo', () => {
  it('filtra righe e importi con segno, mantiene il filtro ordinando e ripristina il totale', () => {
    render(<NettingLegDetailTable rows={rows} viewMode="netting_total" />);
    expectTotals('−2.600 €', '−450 €', '−3.050 €');

    fireEvent.click(screen.getByRole('button', { name: 'Solo PUT (2)' }));
    expectTotals('−600 €', '−150 €', '−750 €');
    expect(screen.queryByText('CALL', { selector: 'td' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Solo PUT (2)' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('columnheader', { name: /Sott\./ }));
    expectTotals('−600 €', '−150 €', '−750 €');

    fireEvent.click(screen.getByRole('button', { name: 'Solo CALL (1)' }));
    expectTotals('−2.000 €', '−300 €', '−2.300 €');
    expect(screen.queryByText('PUT-SHORT')).not.toBeInTheDocument();
    expect(screen.queryByText('PUT-LONG')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tutte (3)' }));
    expectTotals('−2.600 €', '−450 €', '−3.050 €');
    expect(screen.getByText('PUT-SHORT')).toBeVisible();
  });

  it.each(['netting_intrinsic_a', 'netting_intrinsic_b'] as const)('separa il temporale escluso in %s e aggiorna il filtro al cambio snapshot', (viewMode) => {
    const intrinsicRows = [leg('PUT-INT', 'put', -1000, 0, -200), rows[2]];
    const { rerender } = render(<NettingLegDetailTable rows={intrinsicRows} viewMode={viewMode} />);
    fireEvent.click(screen.getByRole('button', { name: 'Solo PUT (1)' }));
    expectTotals('−1.000 €', '0 €', '−1.000 €');
    const footer = screen.getByRole('table').querySelector('tfoot')!;
    expect(within(footer).getByText('escl. −200 €')).toBeVisible();

    rerender(<NettingLegDetailTable rows={[rows[2]]} viewMode={viewMode} />);
    expect(screen.getByText('Nessuna gamba PUT presente')).toBeVisible();
    expectTotals('0 €', '0 €', '0 €');
    fireEvent.click(screen.getByRole('button', { name: 'Tutte (1)' }));
    expectTotals('−2.000 €', '−300 €', '−2.300 €');
  });
});
