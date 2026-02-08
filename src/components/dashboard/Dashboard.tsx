import { useState, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePortfolioContext } from '@/contexts/PortfolioContext';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useDerivativeNetting } from '@/hooks/useDerivativeNetting';
import { useDerivativeOverrides } from '@/hooks/useDerivativeOverrides';
import { useHistoricalData } from '@/hooks/useHistoricalData';
import { useDeposits } from '@/hooks/useDeposits';
import { useEquityExposurePct } from '@/hooks/useEquityExposurePct';
import { useCurrencyExposure } from '@/hooks/useCurrencyExposure';
import { useClearPortfolio, ClearMode } from '@/hooks/useClearPortfolio';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, LogOut, Settings, Save, ShieldAlert, Trash2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { StatsCards } from '@/components/dashboard/StatsCards';
import { PositionsTable } from '@/components/dashboard/PositionsTable';
import { FileUploader } from '@/components/dashboard/FileUploader';
import { HistoricalDataForm } from '@/components/dashboard/HistoricalDataForm';
import { DepositsSection } from '@/components/dashboard/DepositsSection';
import { ViewModeSelector, ViewMode } from '@/components/dashboard/ViewModeSelector';
import { DynamicPortfolioChart } from '@/components/dashboard/DynamicPortfolioChart';
import { HistoricalChartsCarousel } from '@/components/dashboard/HistoricalChartsCarousel';
import { PortfolioSelector } from '@/components/portfolio/PortfolioSelector';
import { ClearDataDialog } from '@/components/dashboard/ClearDataDialog';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { formatRelativeTime } from '@/lib/formatters';
import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import { DepositEntry } from '@/types/deposits';

export function Dashboard() {
  const { user, isAdmin, signOut } = useAuth();
  const { isAggregatedView } = usePortfolioContext();
  const { portfolio, positions, summary, isLoading } = usePortfolio();
  const { overrides } = useDerivativeOverrides();
  const netting = useDerivativeNetting(positions, summary, overrides);
  // Equity exposure for benchmark: only protections, no derivatives
  const { equityExposurePct } = useEquityExposurePct({
    includeNakedPut: false,
    includeStrategies: false,
    includeLeapCall: false
  });
  const { usdExposurePct } = useCurrencyExposure({ includeProtections: false, includeNakedPut: false, includeStrategies: false, includeLeapCall: false, includeBonds: true });

  // Centralized state for unified carousel
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('base');
  
  // Historical data hook now receives viewMode for synthetic deposits calculation
  const { 
    historicalData, 
    syntheticDeposits,
    earliestEntry,
    latestEntry, 
    upsertHistoricalData, 
    deleteHistoricalData,
    isUpserting 
  } = useHistoricalData(portfolio?.id, viewMode);
  
  const {
    deposits,
    totalDeposits,
    upsertDeposit,
    deleteDeposit,
    isUpserting: isUpsertingDeposit,
  } = useDeposits(portfolio?.id);
  
  const { clearPortfolioData, isClearing } = useClearPortfolio();
  
  const [selectedHistoricalDate, setSelectedHistoricalDate] = useState<string | null>(
    earliestEntry?.snapshot_date || null
  );
  
  // New state for P/L calculation
  const [plDeposits, setPlDeposits] = useState<number>(0);
  const [averageBalance, setAverageBalance] = useState<number>(0);
  const [isManualAverageBalance, setIsManualAverageBalance] = useState<boolean>(false);

  // Combine real deposits with synthetic deposits for aggregated view
  const allDepositsForCharts = useMemo((): DepositEntry[] => {
    if (!isAggregatedView) return deposits;
    
    const syntheticAsDeposits: DepositEntry[] = syntheticDeposits.map(sd => ({
      id: `synthetic-${sd.portfolioId}-${sd.date}`,
      portfolio_id: 'AGGREGATED',
      deposit_date: sd.date,
      amount: sd.amount,
      description: 'Apporto sintetico (ingresso portafoglio)',
      created_at: '',
      updated_at: '',
    }));
    
    return [...deposits, ...syntheticAsDeposits];
  }, [deposits, syntheticDeposits, isAggregatedView]);

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

  // Handler for clearing portfolio data
  const handleClearData = async (mode: ClearMode) => {
    if (!portfolio?.id) return;
    await clearPortfolioData(portfolio.id, mode);
  };

  // Check if Excel date is older than the latest saved snapshot
  const excelDate = portfolio?.snapshot_date;
  const lastSavedSnapshotDate = latestEntry?.snapshot_date;
  const showOldExcelWarning = !!(
    excelDate && 
    lastSavedSnapshotDate && 
    new Date(excelDate) < new Date(lastSavedSnapshotDate)
  );

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
              {!isAggregatedView && (
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
                      equity_exposure_pct: equityExposurePct,
                      usd_exposure_pct: usdExposurePct,
                    });
                    toast.success('Snapshot salvato nei dati storici');
                  }}
                  disabled={isUpserting || !summary}
                  title="Salva snapshot corrente nei dati storici"
                >
                  <Save className="w-4 h-4 mr-2" />
                  Salva Snapshot
                </Button>
              )}
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
        {/* Warning banner for old Excel */}
        {showOldExcelWarning && excelDate && lastSavedSnapshotDate && (
          <Alert variant="destructive" className="border-warning/50 bg-warning/10">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <AlertTitle className="text-warning">Attenzione: Excel caricato con data antecedente all'ultimo snapshot salvato</AlertTitle>
            <AlertDescription className="text-muted-foreground">
              Excel: {format(parseISO(excelDate), "dd/MM/yy", { locale: it })} — Ultimo snapshot: {format(parseISO(lastSavedSnapshotDate), "dd/MM/yy", { locale: it })}
            </AlertDescription>
          </Alert>
        )}

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
            allDeposits={allDepositsForCharts}
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

          {/* File Upload & Historical Data - Hidden in aggregated view */}
          {!isAggregatedView && (
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
                    currentEquityExposurePct={equityExposurePct}
                    currentUsdExposurePct={usdExposurePct}
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
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Carica Portfolio</h3>
                <FileUploader />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setClearDialogOpen(true)}
                  disabled={positions.length === 0 || isClearing}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Pulisci Dati Portfolio
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Clear Data Dialog */}
        <ClearDataDialog
          open={clearDialogOpen}
          onOpenChange={setClearDialogOpen}
          portfolioName={portfolio?.name ?? 'Portfolio'}
          onConfirm={handleClearData}
          isClearing={isClearing}
        />

        {/* Historical Charts Carousel */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <HistoricalChartsCarousel
            historicalData={historicalData}
            viewMode={viewMode}
            currentValue={
              viewMode === 'base' ? summary?.totalValue ?? 0
              : viewMode === 'netting_total' ? netting.nettingTotal
              : viewMode === 'netting_ex_cc' ? netting.nettingExCoveredCall
              : netting.nettingExCCAndNP
            }
            currentDate={portfolio?.snapshot_date ?? null}
            deposits={allDepositsForCharts}
          />
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
