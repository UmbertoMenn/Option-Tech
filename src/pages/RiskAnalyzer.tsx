import { useState, useMemo } from 'react';
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
import { RiskViewModeSelector, RiskViewMode } from '@/components/risk/RiskViewModeSelector';
import { EquityExposureView } from '@/components/risk/EquityExposureView';
import { CurrencyExposureView } from '@/components/risk/CurrencyExposureView';
import { calculateCurrencyExposure } from '@/lib/currencyExposure';

export function RiskAnalyzer() {
  const { signOut } = useAuth();
  const [viewMode, setViewMode] = useState<RiskViewMode>('equity');
  
  const riskAnalysis = useRiskAnalysis();
  const { isLoading, ...analysis } = riskAnalysis;
  
  // Calculate currency exposure from existing data
  const currencyExposure = useMemo(() => 
    calculateCurrencyExposure(analysis), 
    [analysis]
  );

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
              <CurrencyExposureView 
                currencyExposure={currencyExposure}
                grandTotal={analysis.grandTotal}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
