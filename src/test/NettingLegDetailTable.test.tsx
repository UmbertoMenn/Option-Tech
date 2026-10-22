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

function clickChip(name: RegExp | string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('NettingLegDetailTable: subtotali per moneyness e scadenza', () => {
  it('filtra righe e importi con segno, mantiene il filtro ordinando e ripristina il totale', () => {
    render(<NettingLegDetailTable rows={rows} viewMode="netting_total" />);
    expectTotals('−2.600 €', '−450 €', '−3.050 €');

    // spot 110 / strike 100: put OTM, call ITM
    clickChip('PUT OTM (2)');
    expectTotals('−600 €', '−150 €', '−750 €');
    expect(screen.queryByText('CALL', { selector: 'td span' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PUT OTM (2)' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('columnheader', { name: /Sott\./ }));
    expectTotals('−600 €', '−150 €', '−750 €');

    // multi-selezione in OR
    clickChip('CALL ITM (1)');
    expectTotals('−2.600 €', '−450 €', '−3.050 €');
    clickChip('PUT OTM (2)');
    expectTotals('−2.000 €', '−300 €', '−2.300 €');
    expect(screen.queryByText('PUT-SHORT')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Tutte' })[0]);
    expectTotals('−2.600 €', '−450 €', '−3.050 €');
    expect(screen.getByText('PUT-SHORT')).toBeVisible();
  });

  it('filtra per scadenza in AND con la moneyness sulla stessa gamba', () => {
    const mixed = [
      { ...leg('P-DIC', 'put', -1000, -200), expiry: '2026-12-18' },
      { ...leg('P-GEN', 'put', -500, -100), expiry: '2027-01-15' },
      { ...leg('C-GEN', 'call', -2000, -300), expiry: '2027-01-15' },
    ];
    render(<NettingLegDetailTable rows={mixed} viewMode="netting_total" />);
    clickChip('15/01/27 (2)');
    expectTotals('−2.500 €', '−400 €', '−2.900 €');
    clickChip('PUT OTM (1)');
    expectTotals('−500 €', '−100 €', '−600 €');
    expect(screen.getByText('P-GEN')).toBeVisible();
    expect(screen.queryByText('P-DIC')).not.toBeInTheDocument();
    clickChip(/Azzera/);
    expectTotals('−3.500 €', '−600 €', '−4.100 €');
  });

  it.each(['netting_intrinsic_a', 'netting_intrinsic_b'] as const)('separa il temporale escluso in %s e aggiorna il filtro al cambio snapshot', (viewMode) => {
    const intrinsicRows = [leg('PUT-INT', 'put', -1000, 0, -200), rows[2]];
    const { rerender } = render(<NettingLegDetailTable rows={intrinsicRows} viewMode={viewMode} />);
    clickChip('PUT OTM (1)');
    expectTotals('−1.000 €', '0 €', '−1.000 €');
    const footer = screen.getByRole('table').querySelector('tfoot')!;
    expect(within(footer).getByText('escl. −200 €')).toBeVisible();

    rerender(<NettingLegDetailTable rows={[rows[2]]} viewMode={viewMode} />);
    expect(screen.getByText('Nessuna gamba per il filtro PUT OTM')).toBeVisible();
    expectTotals('0 €', '0 €', '0 €');
    fireEvent.click(screen.getAllByRole('button', { name: 'Tutte' })[0]);
    expectTotals('−2.000 €', '−300 €', '−2.300 €');
  });
});
