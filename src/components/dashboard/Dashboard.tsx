import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePortfolioContext, AGGREGATED_PORTFOLIO_ID } from '@/contexts/PortfolioContext';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useDerivativeNetting } from '@/hooks/useDerivativeNetting';
import { useDerivativeOverrides } from '@/hooks/useDerivativeOverrides';
import { useUnderlyingPrices } from '@/hooks/useUnderlyingPrices';
import { useHistoricalData } from '@/hooks/useHistoricalData';
import { useDeposits } from '@/hooks/useDeposits';
import { useEquityExposurePct } from '@/hooks/useEquityExposurePct';
import { useCurrencyExposure } from '@/hooks/useCurrencyExposure';
import { useClearPortfolio, ClearMode } from '@/hooks/useClearPortfolio';
import { useStrategyConfigurations } from '@/hooks/useStrategyConfigurations';
import { useGPHoldings } from '@/hooks/useGPHoldings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, LogOut, Settings, ShieldAlert, Trash2, AlertTriangle, Menu, Sun, Moon, Info } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { StatsCards } from '@/components/dashboard/StatsCards';
import { PositionsTable } from '@/components/dashboard/PositionsTable';
import { FileUploader } from '@/components/dashboard/FileUploader';
import { GpSnapshotMissingBanner } from '@/components/dashboard/GpSnapshotMissingBanner';
import { HistoricalDataForm } from '@/components/dashboard/HistoricalDataForm';
import { DepositsSection } from '@/components/dashboard/DepositsSection';
import { ViewModeSelector, ViewMode } from '@/components/dashboard/ViewModeSelector';
import { DynamicPortfolioChart } from '@/components/dashboard/DynamicPortfolioChart';
import { HistoricalChartsCarousel } from '@/components/dashboard/HistoricalChartsCarousel';
import { PortfolioSelector } from '@/components/portfolio/PortfolioSelector';
import { ClearDataDialog } from '@/components/dashboard/ClearDataDialog';
import { IronCondorIcon } from '@/components/ui/iron-condor-icon';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { formatRelativeTime } from '@/lib/formatters';
import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import { Link, useNavigate } from 'react-router-dom';
import { AppHeaderMenu } from '@/components/layout/AppHeaderMenu';
import { DepositEntry } from '@/types/deposits';
import { PortfolioSummary, AssetType } from '@/types/portfolio';


export function Dashboard() {
  const { user, isAdmin, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const { isAggregatedView, selectedPortfolioId } = usePortfolioContext();
  const isGlobalAggregate = selectedPortfolioId === AGGREGATED_PORTFOLIO_ID;
  const { portfolio, positions, summary: rawSummary, isLoading } = usePortfolio();
  const { overrides } = useDerivativeOverrides();
  const { configurations: strategyConfigs, hasConfigurations } = useStrategyConfigurations();
  const { gpHoldings, gpSummary } = useGPHoldings();
  
  // Merge GP values into summary
  const summary: PortfolioSummary | null = useMemo(() => {
    if (!rawSummary) return null;
    if (gpSummary.totalValue === 0) return rawSummary;
    
    const newTotal = rawSummary.totalValue + gpSummary.totalValue;
    const byAssetType = [...rawSummary.byAssetType];
    
    // Add GP stock value to existing stock entry or create one
    if (gpSummary.stockValue > 0) {
      const stockEntry = byAssetType.find(e => e.type === 'stock');
      if (stockEntry) stockEntry.value += gpSummary.stockValue;
      else byAssetType.push({ type: 'stock' as AssetType, value: gpSummary.stockValue, percentage: 0, profitLoss: 0 });
    }
    if (gpSummary.bondValue > 0) {
      const bondEntry = byAssetType.find(e => e.type === 'bond');
      if (bondEntry) bondEntry.value += gpSummary.bondValue;
      else byAssetType.push({ type: 'bond' as AssetType, value: gpSummary.bondValue, percentage: 0, profitLoss: 0 });
    }
    if (gpSummary.cashValue > 0) {
      const cashEntry = byAssetType.find(e => e.type === 'cash');
      if (cashEntry) cashEntry.value += gpSummary.cashValue;
      else byAssetType.push({ type: 'cash' as AssetType, value: gpSummary.cashValue, percentage: 0, profitLoss: 0 });
    }
    
    // Recalculate percentages
    byAssetType.forEach(e => {
      e.percentage = newTotal > 0 ? (e.value / newTotal) * 100 : 0;
    });
    
    return {
      ...rawSummary,
      totalValue: newTotal,
      cashValue: rawSummary.cashValue + gpSummary.cashValue,
      investedValue: rawSummary.investedValue + gpSummary.stockValue + gpSummary.bondValue,
      byAssetType,
    };
  }, [rawSummary, gpSummary]);
  
  // Fetch underlying prices for derivatives without stock in portfolio
  const derivativeUnderlyings = useMemo(() => 
    positions.filter(p => p.asset_type === 'derivative')
      .map(p => p.underlying || p.description)
      .filter((u): u is string => !!u),
    [positions]
  );
  const { prices: underlyingPrices } = useUnderlyingPrices(derivativeUnderlyings);
  
  const netting = useDerivativeNetting(positions, summary, overrides, underlyingPrices, isAggregatedView, strategyConfigs);
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
    isUpserting,
  } = useHistoricalData(portfolio?.id, viewMode);
  
  const {
    deposits,
    totalDeposits,
    upsertDeposit,
    deleteDeposit,
    isUpserting: isUpsertingDeposit,
  } = useDeposits(portfolio?.id);
  
  const { clearPortfolioData, isClearing } = useClearPortfolio();
  
  const [selectedHistoricalDate, setSelectedHistoricalDate] = useState<string | null>(null);
  
  // New state for P/L calculation
  const [plDeposits, setPlDeposits] = useState<number>(0);
  const [averageBalance, setAverageBalance] = useState<number>(0);
  const [isManualAverageBalance, setIsManualAverageBalance] = useState<boolean>(false);

  // Reset calculated values when portfolio changes (but NOT selectedHistoricalDate)
  useEffect(() => {
    setPlDeposits(0);
    setAverageBalance(0);
    setIsManualAverageBalance(false);
  }, [portfolio?.id]);

  // Validate and initialize selectedHistoricalDate when historical data changes
  useEffect(() => {
    // If no historical data, reset to null
    if (historicalData.length === 0) {
      setSelectedHistoricalDate(null);
      return;
    }
    
    // Check if current date exists in the new data
    const currentDateExists = selectedHistoricalDate && 
      historicalData.some(h => h.snapshot_date === selectedHistoricalDate);
    
    // If date doesn't exist in new data (or never set), find the entry closest to 1 year before latest snapshot
    if (!currentDateExists && latestEntry) {
      const latestDate = new Date(latestEntry.snapshot_date);
      const oneYearAgo = new Date(latestDate);
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      
      // Find the entry with snapshot_date closest to oneYearAgo
      let bestEntry = historicalData[0];
      let bestDiff = Math.abs(new Date(bestEntry.snapshot_date).getTime() - oneYearAgo.getTime());
      
      for (const entry of historicalData) {
        const diff = Math.abs(new Date(entry.snapshot_date).getTime() - oneYearAgo.getTime());
        if (diff < bestDiff) {
          bestDiff = diff;
          bestEntry = entry;
        }
      }
      
      setSelectedHistoricalDate(bestEntry.snapshot_date);
    }
  }, [historicalData, latestEntry, selectedHistoricalDate]);

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
              <div className="flex items-center gap-3 shrink-0">
                <div className="p-2 rounded-lg bg-primary/10">
                  <IronCondorIcon size={24} className="text-primary" />
                </div>
                <div>
                  <h1 className="text-lg font-bold">Option Tech</h1>
                  <p className="text-xs text-muted-foreground hidden sm:block">
                    {portfolio?.last_updated && (
                      <span>Aggiornato {formatRelativeTime(portfolio.last_updated)}</span>
                    )}
                  </p>
                </div>
              </div>

              <AppHeaderMenu />

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
        <div className="relative flex items-center justify-center">
          <div className="absolute left-0 flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground hidden sm:inline">Info aggiornamento dati</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
                  <p><strong>Dashboard e Risk Analyzer:</strong> dati aggiornati ai prezzi del file Excel caricato.</p>
                  <p className="mt-1"><strong>Strategie Derivati:</strong> prezzi opzioni delayed 15 min, prezzi sottostanti aggiornati ogni 5 min.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <ViewModeSelector viewMode={viewMode} onViewModeChange={setViewMode} />
        </div>

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
            onViewModeChange={setViewMode}
            overrides={overrides}
            underlyingPrices={underlyingPrices}
            hasConfigurations={hasConfigurations}
            strategyConfigs={strategyConfigs}
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
                <GpSnapshotMissingBanner />
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
            onViewModeChange={setViewMode}
            currentValue={
              viewMode === 'base' ? summary?.totalValue ?? 0
              : viewMode === 'netting_total' ? netting.nettingTotal
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
              <PositionsTable positions={positions} gpHoldings={gpHoldings} />
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
