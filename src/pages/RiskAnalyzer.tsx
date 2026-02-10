import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  ArrowLeft, 
  ShieldAlert, 
  TrendingUp, 
  LogOut
} from 'lucide-react';
import { useRiskAnalysis } from '@/hooks/useRiskAnalysis';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useCurrencyExposure } from '@/hooks/useCurrencyExposure';
import { useSectorMappings } from '@/hooks/useSectorMappings';
import { RiskViewModeSelector, RiskViewMode } from '@/components/risk/RiskViewModeSelector';
import { EquityExposureView } from '@/components/risk/EquityExposureView';
import { CurrencyExposureView } from '@/components/risk/CurrencyExposureView';
import { SectorAllocationView } from '@/components/risk/SectorAllocationView';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PortfolioSelector } from '@/components/portfolio/PortfolioSelector';
import { calculateSectorExposure } from '@/lib/sectorExposure';

export function RiskAnalyzer() {
  const { signOut, isAdmin } = useAuth();
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
  
  const riskAnalysis = useRiskAnalysis();
  const { isLoading, ...analysis } = riskAnalysis;
  const { summary } = usePortfolio();
  
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
  
  // Extract stock info for sector mapping - includes ISIN + description + derivative underlying names
  const stocksForSectorMapping = useMemo(() => {
    const stocks: Array<{ isin: string; description: string }> = [];
    const names: string[] = []; // Derivative underlyings without ISIN
    const seen = new Set<string>();
    
    // 1. Stock diretti (con ISIN) - use isETF flag instead of pattern matching
    for (const stock of analysis.stockDetails) {
      if (stock.isin && !seen.has(stock.isin)) {
        seen.add(stock.isin);
        // Only include non-ETF stocks (use the flag from riskCalculator)
        if (!stock.isETF) {
          stocks.push({ isin: stock.isin, description: stock.underlying });
        }
      }
    }
    
    // 2. Naked PUTs (solo nome sottostante)
    for (const np of analysis.nakedPutDetails) {
      if (!seen.has(np.underlying)) {
        seen.add(np.underlying);
        names.push(np.underlying);
      }
    }
    
    // 3. Leap CALLs (solo nome sottostante)
    for (const lc of analysis.leapCallDetails) {
      if (!seen.has(lc.underlying)) {
        seen.add(lc.underlying);
        names.push(lc.underlying);
      }
    }
    
    // 4. Strategie (solo nome sottostante)
    for (const strat of analysis.strategyDetails) {
      if (!seen.has(strat.underlying)) {
        seen.add(strat.underlying);
        names.push(strat.underlying);
      }
    }
    
    return { stocks, names };
  }, [analysis]);
  
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
      sectorMappings 
    });
  }, [analysis, allocations, sectorIncludeNakedPut, sectorIncludeStrategies, sectorIncludeLeapCall, sectorMappings]);
  
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background-secondary/50 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <ShieldAlert className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-bold">Risk Analyzer</h1>
                <p className="text-xs text-muted-foreground">
                  Esposizione reale in equity (EUR)
                </p>
              </div>
              <div className="ml-4">
                <PortfolioSelector />
              </div>
            </div>
            
            <div className="flex items-center gap-2 overflow-x-auto flex-nowrap">
              <Button variant="outline" size="sm" asChild className="shrink-0">
                <Link to="/">
                  <ArrowLeft className="w-4 h-4" />
                  <span className="hidden sm:inline ml-2">Dashboard</span>
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild className="shrink-0">
                <Link to="/derivatives">
                  <TrendingUp className="w-4 h-4" />
                  <span className="hidden sm:inline ml-2">Strategie Derivati</span>
                </Link>
              </Button>
              <Button variant="ghost" size="sm" onClick={signOut} className="shrink-0">
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline ml-2">Esci</span>
              </Button>
            </div>
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
            {/* Carousel View Mode Selector */}
            <RiskViewModeSelector 
              viewMode={viewMode} 
              onViewModeChange={setViewMode} 
            />
            
            {/* Dynamic Content Based on View Mode */}
            {viewMode === 'equity' ? (
              <EquityExposureView 
                analysis={analysis} 
                portfolioTotalValue={summary?.totalValue}
                etfAllocations={allocations}
                isLoadingETFData={isETFDataLoading}
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
