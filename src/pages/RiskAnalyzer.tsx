import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  ArrowLeft, 
  ShieldAlert, 
  TrendingUp, 
  LogOut,
  RefreshCw
} from 'lucide-react';
import { useRiskAnalysis } from '@/hooks/useRiskAnalysis';
import { useETFAllocations } from '@/hooks/useETFAllocations';
import { RiskViewModeSelector, RiskViewMode } from '@/components/risk/RiskViewModeSelector';
import { EquityExposureView } from '@/components/risk/EquityExposureView';
import { CurrencyExposureView } from '@/components/risk/CurrencyExposureView';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { calculateCurrencyExposure } from '@/lib/currencyExposure';
import { applyETFDecomposition } from '@/lib/etfCurrencyDecomposition';

export function RiskAnalyzer() {
  const { signOut } = useAuth();
  const [viewMode, setViewMode] = useState<RiskViewMode>('equity');
  const [isRefreshingETFs, setIsRefreshingETFs] = useState(false);
  const [hasFetchedETFs, setHasFetchedETFs] = useState(false);
  
  const riskAnalysis = useRiskAnalysis();
  const { isLoading, ...analysis } = riskAnalysis;
  
  const { allocations, fetchMultipleAllocations, loading: etfLoading } = useETFAllocations();
  
  // Calculate base currency exposure from existing data
  const baseCurrencyExposure = useMemo(() => 
    calculateCurrencyExposure(analysis), 
    [analysis]
  );
  
  // Extract ETF ISINs from stock details - look for instruments marked as ETF
  const etfIsins = useMemo(() => {
    const isins: string[] = [];
    const seen = new Set<string>();
    
    for (const stock of analysis.stockDetails) {
      if (stock.isin && !seen.has(stock.isin)) {
        seen.add(stock.isin);
        // Check underlying name for ETF keywords
        const isETF = /ETF|ISHARES|VANGUARD|SPDR|LYXOR|XTRACKERS|AMUNDI|INVESCO|VANECK/i.test(stock.underlying);
        if (isETF) {
          isins.push(stock.isin);
        }
      }
    }
    return isins;
  }, [analysis.stockDetails]);
  
  // Fetch ETF allocations ONCE when switching to currency view
  useEffect(() => {
    if (etfIsins.length > 0 && viewMode === 'currency' && !hasFetchedETFs) {
      setHasFetchedETFs(true);
      fetchMultipleAllocations(etfIsins);
    }
  }, [etfIsins, viewMode, hasFetchedETFs, fetchMultipleAllocations]);
  
  // Apply ETF decomposition to currency exposure
  const currencyExposure = useMemo(() => {
    if (Object.keys(allocations).length === 0) {
      return baseCurrencyExposure;
    }
    return applyETFDecomposition(baseCurrencyExposure, allocations);
  }, [baseCurrencyExposure, allocations]);
  
  // Check if any ETF data is still loading
  const isETFDataLoading = Object.values(etfLoading).some(Boolean);
  
  const handleRefreshETFs = async () => {
    setIsRefreshingETFs(true);
    try {
      await fetchMultipleAllocations(etfIsins);
    } finally {
      setIsRefreshingETFs(false);
    }
  };

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
            </div>
            
            <div className="flex items-center gap-2">
              {viewMode === 'currency' && etfIsins.length > 0 && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleRefreshETFs}
                  disabled={isRefreshingETFs || isETFDataLoading}
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshingETFs ? 'animate-spin' : ''}`} />
                  Aggiorna ETF
                </Button>
              )}
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
              <EquityExposureView analysis={analysis} />
            ) : (
              <ErrorBoundary title="Errore nella vista Currency Exposure">
                <CurrencyExposureView 
                  currencyExposure={currencyExposure}
                  grandTotal={analysis.grandTotal}
                  isLoadingETFData={isETFDataLoading}
                  etfCount={etfIsins.length}
                  loadedETFCount={Object.keys(allocations).filter(isin => etfIsins.includes(isin)).length}
                />
              </ErrorBoundary>
            )}
          </>
        )}
      </main>
    </div>
  );
}
