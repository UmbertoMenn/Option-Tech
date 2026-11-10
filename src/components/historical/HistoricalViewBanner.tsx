import { Button } from '@/components/ui/button';
import { History, X } from 'lucide-react';
import { usePortfolioContext } from '@/contexts/PortfolioContext';
import { useFullSnapshot } from '@/hooks/useFullSnapshot';

function formatDateIt(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
}

/**
 * Banner sticky mostrato in tutte le pagine quando la Visualizzazione Storica
 * è attiva. Chiarisce data e sola lettura, con uscita immediata.
 */
export function HistoricalViewBanner() {
  const { isHistoricalView, historicalViewDate, exitHistoricalView, selectedPortfolio } = usePortfolioContext();
  const { snapshot } = useFullSnapshot();
  const editedAt = snapshot?.configs_edited_at ?? null;

  if (!isHistoricalView || !historicalViewDate) return null;

  return (
    <div className="sticky top-0 z-[60] w-full bg-amber-500/95 text-black shadow-md">
      <div className="flex items-center justify-center gap-3 px-4 py-2 text-sm font-medium flex-wrap">
        <History className="w-4 h-4 shrink-0" />
        <span>
          Visualizzazione storica{selectedPortfolio ? ` — ${selectedPortfolio.name}` : ''} al{' '}
          <strong>{formatDateIt(historicalViewDate)}</strong> · sola lettura
          {editedAt ? (
            <span title="Le configurazioni strategie congelate in questo snapshot sono state corrette a mano (solo questa data).">
              {' '}· configurazioni strategie corrette il {new Date(editedAt).toLocaleDateString('it-IT')}
            </span>
          ) : null}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 bg-black/10 border-black/30 text-black hover:bg-black/20 hover:text-black"
          onClick={exitHistoricalView}
        >
          <X className="w-3.5 h-3.5 mr-1" />
          Torna al presente
        </Button>
      </div>
    </div>
  );
}
