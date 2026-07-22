import { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '@/contexts/AuthContext';
import { useGPHoldings, GPHoldingRow } from '@/hooks/useGPHoldings';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  ArrowLeft, 
  ShieldAlert, 
  TrendingUp, 
  LogOut,
  Menu,
  Settings,
  Sun,
  Moon,
  Info
} from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { useTheme } from 'next-themes';
import { IronCondorIcon } from '@/components/ui/iron-condor-icon';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { AppHeaderMenu } from '@/components/layout/AppHeaderMenu';
import { useRiskAnalysis } from '@/hooks/useRiskAnalysis';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useCurrencyExposure } from '@/hooks/useCurrencyExposure';
import { useSectorMappings } from '@/hooks/useSectorMappings';
import { useDerivativeNetting } from '@/hooks/useDerivativeNetting';
import { useDerivativeOverrides } from '@/hooks/useDerivativeOverrides';
import { useStrategyConfigurations } from '@/hooks/useStrategyConfigurations';
import { useUnderlyingPrices } from '@/hooks/useUnderlyingPrices';
import { useFrozenUnderlyingPrices } from '@/hooks/useFrozenUnderlyingPrices';
import { usePortfolioContext } from '@/contexts/PortfolioContext';
import { RiskViewModeSelector, RiskViewMode } from '@/components/risk/RiskViewModeSelector';
import { EquityExposureView } from '@/components/risk/EquityExposureView';
import { CurrencyExposureView } from '@/components/risk/CurrencyExposureView';
import { SectorAllocationView } from '@/components/risk/SectorAllocationView';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PortfolioSelector } from '@/components/portfolio/PortfolioSelector';
import { calculateSectorExposure } from '@/lib/sectorExposure';
import { useUnderlyingMappings } from '@/hooks/useUnderlyingMappings';
import { buildDynamicAliasMap } from '@/lib/tickerIdentity';

export function RiskAnalyzer() {
  const { signOut, isAdmin } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<RiskViewMode>('equity');
  // Currency Exposure toggles - default: only Bond active
  const [currencyIncludeBonds, setCurrencyIncludeBonds] = useState(true);
  const [currencyIncludeProtections, setCurrencyIncludeProtections] = useState(false);
  const [currencyIncludeNakedPut, setCurrencyIncludeNakedPut] = useState(false);
  const [currencyIncludeStrategies, setCurrencyIncludeStrategies] = useState(false);
  const [currencyIncludeLeapCall, setCurrencyIncludeLeapCall] = useState(false);
  
  // Sector Allocation toggles
  const [sectorIncludeNakedPut, setSectorIncludeNakedPut] = useState(true);
  const [sectorIncludeStrategies, setSectorIncludeStrategies] = useState(true);
  const [sectorIncludeLeapCall, setSectorIncludeLeapCall] = useState(true);
  
  // GP toggles (one per view)
  const [equityIncludeGP, setEquityIncludeGP] = useState(true);
  const [currencyIncludeGP, setCurrencyIncludeGP] = useState(false);
  const [sectorIncludeGP, setSectorIncludeGP] = useState(true);
  
  const riskAnalysis = useRiskAnalysis();
  const { isLoading, ...analysis } = riskAnalysis;
  
  // GP holdings
  const { gpHoldings, gpSummary } = useGPHoldings();
  const gpStockHoldings = useMemo(() => 
    gpHoldings.filter(h => h.asset_type === 'stock'), 
    [gpHoldings]
  );
  const { summary, positions, portfolio } = usePortfolio();
  const { isAggregatedView } = usePortfolioContext();
  const { overrides } = useDerivativeOverrides();
  const { configurations: strategyConfigs } = useStrategyConfigurations();
  const { allMappings } = useUnderlyingMappings();
  const dynamicAliases = useMemo(
    () => buildDynamicAliasMap(allMappings.data || []),
    [allMappings.data],
  );
  const derivativeUnderlyings = useMemo(
    () => positions.filter(p => p.asset_type === 'derivative')
      .map(p => p.underlying || p.description)
      .filter((u): u is string => !!u),
    [positions]
  );
  const { prices: underlyingPrices } = useUnderlyingPrices(derivativeUnderlyings);
  // Netting su PREZZI CONGELATI dello snapshot — identico a Dashboard e Stress Lab.
  const frozenUnderlyingPrices = useFrozenUnderlyingPrices(portfolio, underlyingPrices);
  const netting = useDerivativeNetting(positions, summary, overrides, frozenUnderlyingPrices, isAggregatedView, strategyConfigs, dynamicAliases);

  if (typeof window !== 'undefined') {
    console.log('[RiskAnalyzer] render', {
      isLoading,
      gpHoldingsCount: gpHoldings?.length ?? 0,
      stockDetailsCount: analysis?.stockDetails?.length ?? 0,
      hasSummary: !!summary,
    });
  }
  
  const { mappings: sectorMappings, fetchMappings: fetchSectorMappings, isLoading: sectorMappingsLoading, resolvingCount, reset: resetSectorMappings } = useSectorMappings();
  
  
  // Use centralized currency exposure hook with granular toggles
  const {
    exposures: currencyExposure,
    isLoading: isCurrencyLoading,
    isETFDataLoading,
    etfCount,
    loadedETFCount,
    allocations,
  } = useCurrencyExposure({ 
    includeBonds: currencyIncludeBonds, 
    includeProtections: currencyIncludeProtections, 
    includeNakedPut: currencyIncludeNakedPut, 
    includeStrategies: currencyIncludeStrategies, 
    includeLeapCall: currencyIncludeLeapCall 
  });
  
  // Extract stock info for sector mapping - includes ISIN + description + derivative underlying names + GP stocks
  const stocksForSectorMapping = useMemo(() => {
    const stocks: Array<{ isin: string; description: string }> = [];
    const names: string[] = []; // Derivative underlyings without ISIN
    const seen = new Set<string>();

    const stockDetails = analysis.stockDetails ?? [];
    const nakedPutDetails = analysis.nakedPutDetails ?? [];
    const leapCallDetails = analysis.leapCallDetails ?? [];
    const strategyDetails = analysis.strategyDetails ?? [];

    // 1. Stock diretti (con ISIN) - use isETF flag instead of pattern matching
    for (const stock of stockDetails) {
      if (stock?.isin && !seen.has(stock.isin)) {
        seen.add(stock.isin);
        if (!stock.isETF) {
          stocks.push({ isin: stock.isin, description: stock.underlying });
        }
      }
    }

    // 2. Naked PUTs (solo nome sottostante)
    for (const np of nakedPutDetails) {
      if (np?.underlying && !seen.has(np.underlying)) {
        seen.add(np.underlying);
        names.push(np.underlying);
      }
    }

    // 3. Leap CALLs (solo nome sottostante)
    for (const lc of leapCallDetails) {
      if (lc?.underlying && !seen.has(lc.underlying)) {
        seen.add(lc.underlying);
        names.push(lc.underlying);
      }
    }

    // 4. Strategie (solo nome sottostante)
    for (const strat of strategyDetails) {
      if (strat?.underlying && !seen.has(strat.underlying)) {
        seen.add(strat.underlying);
        names.push(strat.underlying);
      }
    }

    // 5. GP stock holdings (nome/ticker per risoluzione settore)
    for (const gp of (gpStockHoldings ?? [])) {
      const key = gp?.ticker_code || gp?.description;
      if (key && !seen.has(key)) {
        seen.add(key);
        names.push(gp.description);
      }
    }

    return { stocks, names };
  }, [analysis, gpStockHoldings]);
  
  // Fetch sector mappings when switching to sector view
  useEffect(() => {
    const { stocks, names } = stocksForSectorMapping;
    if ((stocks.length > 0 || names.length > 0) && viewMode === 'sector') {
      fetchSectorMappings(stocks, names);
    }
  }, [stocksForSectorMapping, viewMode, fetchSectorMappings]);
  
  
  // Calculate sector exposure with dynamic mappings and granular toggles
  const sectorExposure = useMemo(() => {
    return calculateSectorExposure(analysis, allocations, { 
      includeNakedPut: sectorIncludeNakedPut, 
      includeStrategies: sectorIncludeStrategies, 
      includeLeapCall: sectorIncludeLeapCall, 
      sectorMappings,
      gpStockHoldings: sectorIncludeGP ? gpStockHoldings : [],
    });
  }, [analysis, allocations, sectorIncludeNakedPut, sectorIncludeStrategies, sectorIncludeLeapCall, sectorMappings, sectorIncludeGP, gpStockHoldings]);
  
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
                  Esposizione reale in equity (EUR)
                </p>
              </div>
            </div>

            <AppHeaderMenu />

          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {isLoading || isCurrencyLoading ? (
          <Card className="border-border bg-card">
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <ShieldAlert className="w-12 h-12 mx-auto mb-4 opacity-50 animate-pulse" />
                <p>Caricamento analisi del rischio...</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Info + Carousel View Mode Selector */}
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
            <RiskViewModeSelector 
              viewMode={viewMode} 
              onViewModeChange={setViewMode} 
            />
            </div>
            
            {/* Dynamic Content Based on View Mode */}
            {viewMode === 'equity' ? (
              <EquityExposureView 
                analysis={analysis} 
                portfolioTotalValue={summary?.totalValue}
                portfolioNettingTotal={netting.nettingTotal}
                etfAllocations={allocations}
                isLoadingETFData={isETFDataLoading}
                gpStockHoldings={gpStockHoldings}
                includeGP={equityIncludeGP}
                onIncludeGPChange={setEquityIncludeGP}
              />
            ) : viewMode === 'currency' ? (
              <ErrorBoundary title="Errore nella vista Currency Exposure">
                <CurrencyExposureView 
                  currencyExposure={currencyExposure}
                  grandTotal={currencyExposure.reduce((sum, c) => sum + c.totalRisk, 0)}
                  isLoadingETFData={isETFDataLoading}
                  etfCount={etfCount}
                  loadedETFCount={loadedETFCount}
                  includeBonds={currencyIncludeBonds}
                  onIncludeBondsChange={setCurrencyIncludeBonds}
                  includeProtections={currencyIncludeProtections}
                  onIncludeProtectionsChange={setCurrencyIncludeProtections}
                  includeNakedPut={currencyIncludeNakedPut}
                  onIncludeNakedPutChange={setCurrencyIncludeNakedPut}
                  includeStrategies={currencyIncludeStrategies}
                  onIncludeStrategiesChange={setCurrencyIncludeStrategies}
                  gpStockHoldings={gpStockHoldings}
                  includeGP={currencyIncludeGP}
                  onIncludeGPChange={setCurrencyIncludeGP}
                  includeLeapCall={currencyIncludeLeapCall}
                  onIncludeLeapCallChange={setCurrencyIncludeLeapCall}
                />
              </ErrorBoundary>
            ) : (
              <ErrorBoundary title="Errore nella vista Sector Allocation">
                <SectorAllocationView 
                  sectorExposure={sectorExposure}
                  grandTotal={sectorExposure.reduce((sum, s) => sum + s.totalRisk, 0)}
                  isLoadingETFData={isETFDataLoading}
                  etfCount={etfCount}
                  loadedETFCount={loadedETFCount}
                  includeNakedPut={sectorIncludeNakedPut}
                  onIncludeNakedPutChange={setSectorIncludeNakedPut}
                  includeStrategies={sectorIncludeStrategies}
                  onIncludeStrategiesChange={setSectorIncludeStrategies}
                  includeLeapCall={sectorIncludeLeapCall}
                  onIncludeLeapCallChange={setSectorIncludeLeapCall}
                  includeGP={sectorIncludeGP}
                  onIncludeGPChange={setSectorIncludeGP}
                  isResolvingSectors={sectorMappingsLoading}
                  resolvingCount={resolvingCount}
                  isAdmin={isAdmin}
                  onRefreshMappings={() => {
                    // Reset mappings to force refetch
                    resetSectorMappings();
                    const { stocks, names } = stocksForSectorMapping;
                    if (stocks.length > 0 || names.length > 0) {
                      // Refetch after a short delay
                      setTimeout(() => {
                        fetchSectorMappings(stocks, names);
                      }, 300);
                    }
                  }}
                />
              </ErrorBoundary>
            )}
          </>
        )}
      </main>
    </div>
  );
}
