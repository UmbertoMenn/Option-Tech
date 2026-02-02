import { useState, useMemo, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
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
import { useETFAllocations } from '@/hooks/useETFAllocations';
import { useSectorMappings } from '@/hooks/useSectorMappings';
import { RiskViewModeSelector, RiskViewMode } from '@/components/risk/RiskViewModeSelector';
import { EquityExposureView } from '@/components/risk/EquityExposureView';
import { CurrencyExposureView } from '@/components/risk/CurrencyExposureView';
import { SectorAllocationView } from '@/components/risk/SectorAllocationView';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PortfolioSelector } from '@/components/portfolio/PortfolioSelector';
import { calculateCurrencyExposure } from '@/lib/currencyExposure';
import { applyETFDecomposition } from '@/lib/etfCurrencyDecomposition';
import { calculateSectorExposure, calculateTopHoldings } from '@/lib/sectorExposure';

export function RiskAnalyzer() {
  const { signOut, isAdmin } = useAuth();
  const [viewMode, setViewMode] = useState<RiskViewMode>('equity');
  const [hasFetchedETFs, setHasFetchedETFs] = useState(false);
  const [includeDerivatives, setIncludeDerivatives] = useState(true);
  const [includeBonds, setIncludeBonds] = useState(true);
  
  const riskAnalysis = useRiskAnalysis();
  const { isLoading, ...analysis } = riskAnalysis;
  const { summary } = usePortfolio();
  
  const { allocations, fetchMultipleAllocations, loading: etfLoading } = useETFAllocations();
  const { mappings: sectorMappings, fetchMappings: fetchSectorMappings, isLoading: sectorMappingsLoading, resolvingCount, reset: resetSectorMappings } = useSectorMappings();
  const toastShownRef = useRef(false);
  
  // Calculate base currency exposure from existing data
  const baseCurrencyExposure = useMemo(() => 
    calculateCurrencyExposure(analysis, { includeDerivatives, includeBonds }), 
    [analysis, includeDerivatives, includeBonds]
  );
  
  // Pattern per riconoscere ETF (sincronizzato con excelParser.ts e currencyExposure.ts)
  const ETF_PATTERN = /ETF|UCITS|ISHARES|ISHSIII|ISHSIV|ISHSV|ISHSVII|VANGUARD|VNG|SPDR|SSG|LYXOR|AMUNDI|XTRACKERS|XTRK|INVESCO|VANECK|WISDOMTREE|WTR|UBS ETF|HSBC ETF|FRANKLIN/i;
  
  // Extract ETF ISINs from stock details - look for instruments marked as ETF
  const etfIsins = useMemo(() => {
    const isins: string[] = [];
    const seen = new Set<string>();
    
    for (const stock of analysis.stockDetails) {
      if (stock.isin && !seen.has(stock.isin)) {
        seen.add(stock.isin);
        // Check underlying name for ETF keywords with expanded patterns
        if (ETF_PATTERN.test(stock.underlying)) {
          isins.push(stock.isin);
        }
      }
    }
    return isins;
  }, [analysis.stockDetails]);
  
  // Fetch ETF allocations ONCE when switching to currency or sector view
  useEffect(() => {
    if (etfIsins.length > 0 && (viewMode === 'currency' || viewMode === 'sector') && !hasFetchedETFs) {
      setHasFetchedETFs(true);
      fetchMultipleAllocations(etfIsins);
    }
  }, [etfIsins, viewMode, hasFetchedETFs, fetchMultipleAllocations]);
  
  // Extract stock info for sector mapping - includes ISIN + description + derivative underlying names
  const stocksForSectorMapping = useMemo(() => {
    const stocks: Array<{ isin: string; description: string }> = [];
    const names: string[] = []; // Derivative underlyings without ISIN
    const seen = new Set<string>();
    
    // 1. Stock diretti (con ISIN)
    for (const stock of analysis.stockDetails) {
      if (stock.isin && !seen.has(stock.isin)) {
        seen.add(stock.isin);
        // Only include non-ETF stocks
        if (!ETF_PATTERN.test(stock.underlying)) {
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
  
  // Show toast when AI sector resolution is in progress
  useEffect(() => {
    if (resolvingCount > 0 && !toastShownRef.current) {
      toastShownRef.current = true;
      toast.loading(`Risoluzione AI settori per ${resolvingCount} strumenti...`, {
        id: 'sector-resolution',
        duration: Infinity,
      });
    } else if (resolvingCount === 0 && toastShownRef.current) {
      toast.dismiss('sector-resolution');
      toast.success('Settori aggiornati', { duration: 2000 });
      toastShownRef.current = false;
    }
  }, [resolvingCount]);
  
  // Apply ETF decomposition to currency exposure
  const currencyExposure = useMemo(() => {
    if (Object.keys(allocations).length === 0) {
      return baseCurrencyExposure;
    }
    return applyETFDecomposition(baseCurrencyExposure, allocations);
  }, [baseCurrencyExposure, allocations]);
  
  // Calculate sector exposure with dynamic mappings
  const sectorExposure = useMemo(() => {
    return calculateSectorExposure(analysis, allocations, { includeDerivatives, sectorMappings });
  }, [analysis, allocations, includeDerivatives, sectorMappings]);
  
  // Calculate top holdings
  const topHoldings = useMemo(() => {
    return calculateTopHoldings(analysis, allocations, 20);
  }, [analysis, allocations]);
  
  
  // Check if any ETF data is still loading
  const isETFDataLoading = Object.values(etfLoading).some(Boolean);
  
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
            
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Dashboard
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/derivatives">
                  <TrendingUp className="w-4 h-4 mr-2" />
                  Strategie Derivati
                </Link>
              </Button>
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut className="w-4 h-4 mr-2" />
                Esci
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {isLoading ? (
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
              <EquityExposureView analysis={analysis} portfolioTotalValue={summary?.totalValue} />
            ) : viewMode === 'currency' ? (
              <ErrorBoundary title="Errore nella vista Currency Exposure">
                <CurrencyExposureView 
                  currencyExposure={currencyExposure}
                  grandTotal={currencyExposure.reduce((sum, c) => sum + c.totalRisk, 0)}
                  isLoadingETFData={isETFDataLoading}
                  etfCount={etfIsins.length}
                  loadedETFCount={Object.keys(allocations).filter(isin => etfIsins.includes(isin)).length}
                  includeDerivatives={includeDerivatives}
                  onIncludeDerivativesChange={setIncludeDerivatives}
                  includeBonds={includeBonds}
                  onIncludeBondsChange={setIncludeBonds}
                />
              </ErrorBoundary>
            ) : (
              <ErrorBoundary title="Errore nella vista Sector Allocation">
                <SectorAllocationView 
                  sectorExposure={sectorExposure}
                  topHoldings={topHoldings}
                  grandTotal={sectorExposure.reduce((sum, s) => sum + s.totalRisk, 0)}
                  isLoadingETFData={isETFDataLoading}
                  etfCount={etfIsins.length}
                  loadedETFCount={Object.keys(allocations).filter(isin => etfIsins.includes(isin)).length}
                  includeDerivatives={includeDerivatives}
                  onIncludeDerivativesChange={setIncludeDerivatives}
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
