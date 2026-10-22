import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OptionLegFilterBar } from '@/components/derivatives/OptionLegFilterBar';
import { EMPTY_OPTION_LEG_FILTER } from '@/lib/optionLegFilter';

afterEach(cleanup);

const legs = [[{ optionType: 'put' as const, strike: 100, spot: 90, expiry: '2026-12-18' }]];

describe('OptionLegFilterBar', () => {
  it('showMoneyness=false (Posizioni da monitorare): solo filtro scadenza', () => {
    const onChange = vi.fn();
    render(<OptionLegFilterBar value={EMPTY_OPTION_LEG_FILTER} onChange={onChange} itemsLegs={legs} showMoneyness={false} />);
    expect(screen.queryByRole('button', { name: /PUT ITM/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Opzioni')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '18/12/26 (1)' }));
    expect(onChange).toHaveBeenCalledWith({ buckets: [], expiries: ['2026-12-18'] });
  });

  it('default: mostra anche i filtri ITM/OTM', () => {
    render(<OptionLegFilterBar value={EMPTY_OPTION_LEG_FILTER} onChange={() => {}} itemsLegs={legs} />);
    expect(screen.getByRole('button', { name: 'PUT ITM (1)' })).toBeInTheDocument();
  });
});
