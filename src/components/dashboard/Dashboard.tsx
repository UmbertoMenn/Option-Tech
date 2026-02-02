import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useDerivativeNetting } from '@/hooks/useDerivativeNetting';
import { useDerivativeOverrides } from '@/hooks/useDerivativeOverrides';
import { useHistoricalData } from '@/hooks/useHistoricalData';
import { useDeposits } from '@/hooks/useDeposits';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, LogOut, Settings, Save, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { StatsCards } from '@/components/dashboard/StatsCards';
import { PositionsTable } from '@/components/dashboard/PositionsTable';
import { FileUploader } from '@/components/dashboard/FileUploader';
import { HistoricalDataForm } from '@/components/dashboard/HistoricalDataForm';
import { DepositsSection } from '@/components/dashboard/DepositsSection';
import { ViewModeSelector, ViewMode } from '@/components/dashboard/ViewModeSelector';
import { DynamicPortfolioChart } from '@/components/dashboard/DynamicPortfolioChart';
import { PortfolioSelector } from '@/components/portfolio/PortfolioSelector';
import { formatRelativeTime } from '@/lib/formatters';
import { Link } from 'react-router-dom';

export function Dashboard() {
  const { user, isAdmin, signOut } = useAuth();
  const { portfolio, positions, summary, isLoading } = usePortfolio();
  const { overrides } = useDerivativeOverrides();
  const netting = useDerivativeNetting(positions, summary, overrides);
  const { 
    historicalData, 
    earliestEntry, 
    upsertHistoricalData, 
    deleteHistoricalData,
    isUpserting 
  } = useHistoricalData(portfolio?.id);
  const {
    deposits,
    totalDeposits,
    upsertDeposit,
    deleteDeposit,
    isUpserting: isUpsertingDeposit,
  } = useDeposits(portfolio?.id);

  // Centralized state for unified carousel
  const [viewMode, setViewMode] = useState<ViewMode>('base');
  const [selectedHistoricalDate, setSelectedHistoricalDate] = useState<string | null>(
    earliestEntry?.snapshot_date || null
  );
  
  // New state for P/L calculation
  const [plDeposits, setPlDeposits] = useState<number>(0);
  const [averageBalance, setAverageBalance] = useState<number>(0);
  const [isManualAverageBalance, setIsManualAverageBalance] = useState<boolean>(false);

  // Update selected date when earliest entry changes (on first load)
  if (earliestEntry && !selectedHistoricalDate && historicalData.length > 0) {
    setSelectedHistoricalDate(earliestEntry.snapshot_date);
  }
  
  // Reset deposits and averageBalance when historical date changes
  const handleHistoricalDateChange = (date: string | null) => {
    setSelectedHistoricalDate(date);
    setPlDeposits(0);
    setAverageBalance(0);
    setIsManualAverageBalance(false);
  };

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background-secondary/50 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <TrendingUp className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-bold">Portfolio Monitor</h1>
                <p className="text-xs text-muted-foreground">
                  {portfolio?.last_updated && (
                    <span>Aggiornato {formatRelativeTime(portfolio.last_updated)}</span>
                  )}
                </p>
              </div>
              <div className="ml-4">
                <PortfolioSelector />
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => {
                  if (!portfolio?.snapshot_date) {
                    toast.error('Nessuna data disponibile. Carica prima un file Excel.');
                    return;
                  }
                  upsertHistoricalData({
                    snapshot_date: portfolio.snapshot_date,
                    total_value: summary?.totalValue ?? 0,
                    netting_total: netting.nettingTotal,
                    netting_ex_cc: netting.nettingExCoveredCall,
                    netting_ex_cc_np: netting.nettingExCCAndNP,
                    deposits: 0,
                    average_balance: 0,
                  });
                  toast.success('Snapshot salvato nei dati storici');
                }}
                disabled={isUpserting || !summary}
                title="Salva snapshot corrente nei dati storici"
              >
                <Save className="w-4 h-4 mr-2" />
                Salva Snapshot
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/derivatives">
                  <TrendingUp className="w-4 h-4 mr-2" />
                  Strategie Derivati
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/risk-analyzer">
                  <ShieldAlert className="w-4 h-4 mr-2" />
                  Risk Analyzer
                </Link>
              </Button>
              {isAdmin && (
                <Button variant="outline" size="sm" asChild>
                  <Link to="/admin">
                    <Settings className="w-4 h-4 mr-2" />
                    Admin
                  </Link>
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut className="w-4 h-4 mr-2" />
                Esci
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-8">
        {/* Unified View Mode Selector */}
        <ViewModeSelector viewMode={viewMode} onViewModeChange={setViewMode} />

        {/* Stats */}
        {summary && (
          <StatsCards 
            summary={summary} 
            portfolio={portfolio}
            nettingTotal={netting.nettingTotal}
            nettingExCC={netting.nettingExCoveredCall}
            nettingExCCAndNP={netting.nettingExCCAndNP}
            viewMode={viewMode}
            historicalData={historicalData}
            selectedHistoricalDate={selectedHistoricalDate}
            onHistoricalDateChange={handleHistoricalDateChange}
            deposits={plDeposits}
            averageBalance={averageBalance}
            isManualAverageBalance={isManualAverageBalance}
            onDepositsChange={setPlDeposits}
            onAverageBalanceChange={setAverageBalance}
            onManualAverageBalanceToggle={setIsManualAverageBalance}
            allDeposits={deposits}
          />
        )}

        {/* Main content grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Dynamic Portfolio Chart */}
          <DynamicPortfolioChart 
            summary={summary} 
            portfolio={portfolio} 
            positions={positions} 
            netting={netting}
            viewMode={viewMode}
          />

          {/* File Upload & Historical Data */}
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Gestione Dati</h3>
              <div className="space-y-3">
                <HistoricalDataForm
                  historicalData={historicalData}
                  onSave={upsertHistoricalData}
                  onDelete={deleteHistoricalData}
                  isLoading={isUpserting}
                  currentTotalValue={summary?.totalValue ?? 0}
                  currentNettingTotal={netting.nettingTotal}
                  currentNettingExCC={netting.nettingExCoveredCall}
                  currentNettingExCCNP={netting.nettingExCCAndNP}
                />
                <DepositsSection
                  deposits={deposits}
                  totalDeposits={totalDeposits}
                  onSave={upsertDeposit}
                  onDelete={deleteDeposit}
                  isLoading={isUpsertingDeposit}
                />
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Carica Portfolio</h3>
              <FileUploader />
            </div>
          </div>
        </div>

        {/* Positions Table */}
        {positions.length > 0 && (
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-lg">Posizioni</CardTitle>
            </CardHeader>
            <CardContent>
              <PositionsTable positions={positions} />
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="container mx-auto space-y-8">
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-6">
          <Skeleton className="col-span-2 h-[400px] rounded-lg" />
          <Skeleton className="h-[400px] rounded-lg" />
        </div>
      </div>
    </div>
  );
}
