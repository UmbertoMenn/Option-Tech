import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { PerformanceAttributionChart } from '@/components/dashboard/charts/PerformanceAttributionChart';
import { HistoricalDataEntry } from '@/types/historicalData';

const dates = ['2026-07-08', '2026-07-31', '2026-08-27', '2026-09-09'];
vi.mock('@/hooks/usePerformanceAttribution', () => ({
  usePerformanceAttribution: () => ({
    isLoading: false,
    data: {
      snapshots: ['2026-07-08', '2026-07-31', '2026-08-27', '2026-09-09'].map(snapshot_date => ({
        portfolio_id: 'test', snapshot_date, positions: [], strategy_configurations: [],
        derivative_overrides: [], gp_holdings: [], cash_value: 10000, gp_total_value: null,
      })),
      trades: [], internalTransfers: [], movements: [],
      movementUploads: ['cash', 'titoli'].map(source => ({ source, periodStart: '2026-08-01', periodEnd: '2026-08-31' })),
    },
  }),
}));

describe('scomposizione visibile', () => {
  it('mostra il periodo effettivo e spiega movimenti, percentuali e premi al clic', () => {
    render(<QueryClientProvider client={new QueryClient()}>
      <PerformanceAttributionChart portfolioId="test" deposits={[]} historicalData={dates.map(snapshot_date => ({
        snapshot_date, netting_total: 10000,
      } as HistoricalDataEntry))} />
    </QueryClientProvider>);
    expect(screen.queryByTestId('attribution-period-summary')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Filtri e dettagli' }));
    const summary = screen.getByTestId('attribution-period-summary');
    expect(summary).toHaveTextContent('31/07/2026');
    expect(summary).toHaveTextContent('27/08/2026');
    expect(summary).not.toHaveTextContent('09/09/2026');
    fireEvent.click(screen.getByRole('button', { name: 'Informazioni: Movimenti netti' }));
    expect(screen.getByText(/Flussi della classe, non guadagni/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Informazioni: Movimenti netti' }));
    fireEvent.click(screen.getByRole('button', { name: 'Informazioni: Percentuale di rendimento' }));
    expect(screen.getByText(/non è annualizzato/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Informazioni: Percentuale di rendimento' }));
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: 'Informazioni: Premi temporali opzioni' }));
    expect(screen.getByText(/un premio incassato non è subito tutto guadagno/)).toBeVisible();
  });
});
