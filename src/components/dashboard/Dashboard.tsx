import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePortfolioContext, AGGREGATED_PORTFOLIO_ID } from '@/contexts/PortfolioContext';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useDerivativeNetting, compareNettingMethods } from '@/hooks/useDerivativeNetting';
import { useDerivativeOverrides } from '@/hooks/useDerivativeOverrides';
import { useUnderlyingPrices, UnderlyingPrice } from '@/hooks/useUnderlyingPrices';
import { useHistoricalData } from '@/hooks/useHistoricalData';
import { useDeposits } from '@/hooks/useDeposits';
import { useEquityExposurePct } from '@/hooks/useEquityExposurePct';
import { useCurrencyExposure } from '@/hooks/useCurrencyExposure';
import { useClearPortfolio, ClearMode } from '@/hooks/useClearPortfolio';
import { useStrategyConfigurations } from '@/hooks/useStrategyConfigurations';
import { useGPHoldings } from '@/hooks/useGPHoldings';
import { useCallBuybacks, openCallBuybacksValueEUR } from '@/hooks/useCallBuybacks';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, LogOut, Settings, ShieldAlert, Trash2, AlertTriangle, Menu, Sun, Moon, Info, Upload } from 'lucide-react';
import { PmcUploadDialog } from '@/components/dashboard/PmcUploadDialog';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { useTheme } from 'next-themes';
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
  const { isAggregatedView, selectedPortfolioId, isReady: isPortfolioReady } = usePortfolioContext();
  const isGlobalAggregate = selectedPortfolioId === AGGREGATED_PORTFOLIO_ID;
  const { portfolio, positions, summary: rawSummary, isLoading, isHistoricalView, isReadOnly } = usePortfolio();

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

  // Equity exposure for benchmark: only protections, no derivatives
  const { equityExposurePct } = useEquityExposurePct({
    includeNakedPut: false,
    includeStrategies: false,
    includeLeapCall: false
  });
  const { usdExposurePct } = useCurrencyExposure({ includeProtections: false, includeNakedPut: false, includeStrategies: false, includeLeapCall: false, includeBonds: true });

  // Centralized state for unified carousel
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [pmcDialogOpen, setPmcDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('netting_total');
  const [includeCallBuybacks, setIncludeCallBuybacks] = useState(false);
  const portfolioIds = useMemo(
    () => [...new Set(positions.map(position => position.portfolio_id))],
    [positions],
  );
  const { buybacks } = useCallBuybacks(portfolioIds);
  const callBuybacksValueEUR = useMemo(
    () => openCallBuybacksValueEUR(buybacks),
    [buybacks],
  );

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

  // Prezzi CONGELATI dello snapshot corrente: la card di netting NON deve muoversi
  // coi prezzi live. Prendo i prezzi fissati nel record storico della data corrente
  // del portafoglio e li uso per il netting. Fallback ai prezzi live solo per i
  // sottostanti non ancora congelati (es. snapshot non ancora ricalcolato): al primo
  // ricalcolo dello snapshot vengono congelati e da lì in poi il valore è stabile.
  const frozenUnderlyingPrices = useMemo(() => {
    const currentDate = portfolio?.snapshot_date;
    const currentEntry = currentDate
      ? historicalData.find(h => h.snapshot_date === currentDate)
      : null;
    const frozenRaw = (currentEntry?.snapshot_underlying_prices ?? {}) as Record<string, number>;
    const merged: Record<string, UnderlyingPrice> = {};
    for (const [k, v] of Object.entries(underlyingPrices)) merged[k] = v;
    for (const [k, px] of Object.entries(frozenRaw)) {
      if (typeof px === 'number' && px > 0) merged[k] = { price: px, currency: 'USD' };
    }
    return merged;
  }, [portfolio?.snapshot_date, historicalData, underlyingPrices]);

  const netting = useDerivativeNetting(positions, summary, overrides, frozenUnderlyingPrices, isAggregatedView, strategyConfigs);
  // Il premio di mercato dei riacquisti aperti (call da rivendere) è patrimonio
  // netting intrinseco mancante sia in vista A che in vista B: entrambe valutano
  // le call vendute a intrinseco, quindi entrambe "perdono" il valore della call
  // già ricomprata e non ancora rivenduta. Vanno corrette allo stesso modo.
  const nettingIntrinsicA = netting.nettingIntrinsicA + (includeCallBuybacks ? callBuybacksValueEUR : 0);
  const nettingIntrinsicB = netting.nettingIntrinsicB + (includeCallBuybacks ? callBuybacksValueEUR : 0);

  // Componenti del patrimonio (vista Netting Totale): liquidità, azioni, obbligazioni,
  // GP (conto 08...) e derivati (contributo MTM, tipicamente negativo).
  const patrimonyComponents = useMemo(() => {
    if (!summary) return undefined;
    const assetValue = (type: AssetType) =>
      summary.byAssetType.find(e => e.type === type)?.value ?? 0;
    return {
      liquidity: summary.cashValue - gpSummary.cashValue,
      stocks: assetValue('stock') + assetValue('etf') + assetValue('commodity') - gpSummary.stockValue,
      bonds: assetValue('bond') - gpSummary.bondValue,
      gp: gpSummary.totalValue,
      derivatives: netting.nettingTotal - summary.totalValue,
      total: netting.nettingTotal,
    };
  }, [summary, gpSummary, netting.nettingTotal]);

  // DEBUG diagnostico: confronto market value vs Netting Intrinseco (A) vs Netting Intrinseco (B).
  // Attivazione: in console -> localStorage.setItem('nettingDebug','1'); poi seleziona il portfolio e ricarica.
  // Disattivazione: localStorage.removeItem('nettingDebug').
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem('nettingDebug') !== '1') return;
    if (!summary || positions.length === 0) return;
    const cmp = compareNettingMethods(positions, summary.totalValue, overrides, frozenUnderlyingPrices, strategyConfigs);
    const fmt = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 0 });
    /* eslint-disable no-console */
    console.log(`%c[NETTING] ${portfolio?.name ?? 'portfolio'} — confronto metodi`, 'font-weight:bold;font-size:13px');
    console.table(cmp.rows.map(r => ({
      cat: r.category,
      ticker: r.ticker,
      descr: r.description,
      tipo: r.optionType,
      qty: r.quantity,
      strike: r.strike,
      prezzoOpz: r.price,
      prezzoSott: r.underlyingPrice,
      'MARKET': Math.round(r.marketValue),
      'INTRINSECO (A)': Math.round(r.intrinsicA),
      'INTRINSECO (B)': Math.round(r.intrinsicB),
      'Δ B−A': Math.round(r.intrinsicB - r.intrinsicA),
    })));
    console.log(
      `Base (patrimonio non-derivati): €${fmt(cmp.baseValue)}\n` +
      `Σ derivati  — market: €${fmt(cmp.totals.marketValue)} | intrinseco A: €${fmt(cmp.totals.intrinsicA)} | intrinseco B: €${fmt(cmp.totals.intrinsicB)}\n` +
      `NETTING totale:          €${fmt(cmp.finalMarket)}\n` +
      `NETTING INTRINSECO (A):  €${fmt(cmp.finalIntrinsicA)}\n` +
      `NETTING INTRINSECO (B):  €${fmt(cmp.finalIntrinsicB)}`
    );
    /* eslint-enable no-console */
  }, [positions, summary, overrides, frozenUnderlyingPrices, strategyConfigs, portfolio?.name]);
  
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

  // Attende sia il ripristino della lista portafogli (auto-selezione del principale)
  // sia il caricamento delle posizioni del portafoglio corrente, così da evitare
  // un flash con "tutto a zero" al login prima che la selezione sia completa.
  if (!isPortfolioReady || isLoading) {
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
                  <Info className="w-4 h-4 text-muted-foreground cursor-pointer" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
                  <p><strong>Dashboard e Risk Analyzer:</strong> dati aggiornati ai prezzi del file Excel caricato.</p>
                  <p className="mt-1"><strong>Strategie Derivati:</strong> prezzi opzioni delayed 15 min, prezzi sottostanti aggiornati ogni 5 min.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <ViewModeSelector
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            includeCallBuybacks={includeCallBuybacks}
            onIncludeCallBuybacksChange={setIncludeCallBuybacks}
          />
        </div>

        {/* Stats */}
        {summary && (
          <StatsCards 
            summary={summary} 
            portfolio={portfolio}
            nettingTotal={netting.nettingTotal}
            nettingIntrinsicA={nettingIntrinsicA}
            nettingIntrinsicB={nettingIntrinsicB}
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
            underlyingPrices={frozenUnderlyingPrices}
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
                    currentNettingIntrinsicA={nettingIntrinsicA}
                    currentNettingIntrinsicB={nettingIntrinsicB}
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
              {!isHistoricalView && (
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
              )}
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
              viewMode === 'netting_total' ? netting.nettingTotal
              : viewMode === 'netting_intrinsic_a' ? nettingIntrinsicA
              : nettingIntrinsicB
            }
            currentDate={portfolio?.snapshot_date ?? null}
            deposits={allDepositsForCharts}
            patrimonyComponents={patrimonyComponents}
          />
        </div>

        {/* Positions Table */}
        {positions.length > 0 && (
          <Card className="border-border bg-card">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-lg">Posizioni</CardTitle>
                {!isReadOnly && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => setPmcDialogOpen(true)}
                  >
                    <Upload className="w-3.5 h-3.5 mr-1.5" /> Carica PMC (Excel)
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <PositionsTable positions={positions} gpHoldings={gpHoldings} />
            </CardContent>
          </Card>
        )}
        <PmcUploadDialog
          portfolioId={portfolio?.id}
          open={pmcDialogOpen}
          onOpenChange={setPmcDialogOpen}
        />
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
