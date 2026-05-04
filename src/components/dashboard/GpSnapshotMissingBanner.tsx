import { useMemo, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle, X } from 'lucide-react';
import { useGPHoldings } from '@/hooks/useGPHoldings';
import { useHistoricalData } from '@/hooks/useHistoricalData';
import { usePortfolio } from '@/hooks/usePortfolio';

/**
 * Mostra un avviso quando l'utente ha una GP caricata più recente dello
 * snapshot del portafoglio principale: in quel caso lo snapshot storico
 * (in historical_data) non è stato aggiornato e i grafici risulteranno
 * disallineati rispetto alle card live.
 */
export function GpSnapshotMissingBanner() {
  const { portfolio } = usePortfolio();
  const { gpHoldings } = useGPHoldings();
  const { historicalData } = useHistoricalData();
  const [dismissed, setDismissed] = useState(false);

  const shouldShow = useMemo(() => {
    if (dismissed) return false;
    if (!portfolio?.id) return false;
    if (!gpHoldings || gpHoldings.length === 0) return false;

    // Filtra GP del portfolio corrente
    const ownGp = gpHoldings.filter(h => h.portfolio_id === portfolio.id);
    if (ownGp.length === 0) return false;

    // Data più recente di aggiornamento GP
    const latestGpUpdate = ownGp.reduce<string | null>((max, h) => {
      const d = h.updated_at || h.created_at;
      if (!d) return max;
      return !max || d > max ? d : max;
    }, null);
    if (!latestGpUpdate) return false;

    const portfolioSnapshotDate = portfolio.snapshot_date;
    if (!portfolioSnapshotDate) return true; // GP presente ma nessun portafoglio caricato

    // Esiste uno snapshot storico per la data del portafoglio?
    const hasMatchingHistorical = (historicalData || []).some(
      h => h.portfolio_id === portfolio.id && h.snapshot_date === portfolioSnapshotDate
    );
    if (!hasMatchingHistorical) return true;

    // GP aggiornata dopo la data dello snapshot del portafoglio?
    // Confronto: portfolio.snapshot_date è una date (YYYY-MM-DD), latestGpUpdate è ISO timestamp.
    const snapshotDateOnly = portfolioSnapshotDate;
    const gpDateOnly = latestGpUpdate.slice(0, 10);
    return gpDateOnly > snapshotDateOnly;
  }, [dismissed, portfolio?.id, portfolio?.snapshot_date, gpHoldings, historicalData]);

  if (!shouldShow) return null;

  return (
    <Alert className="border-amber-500/40 bg-amber-500/10 text-foreground">
      <AlertTriangle className="h-4 w-4 text-amber-500" />
      <div className="flex items-start justify-between gap-2 w-full">
        <div className="flex-1">
          <AlertTitle className="text-sm">Snapshot storico non aggiornato</AlertTitle>
          <AlertDescription className="text-xs mt-1">
            Hai caricato una Gestione Patrimoniale, ma lo snapshot storico verrà
            aggiornato solo dopo aver caricato un nuovo file Portafoglio. Finché
            non lo carichi, i grafici storici potrebbero non coincidere con le card.
          </AlertDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 -mr-1 -mt-1"
          onClick={() => setDismissed(true)}
          aria-label="Chiudi avviso"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </Alert>
  );
}
