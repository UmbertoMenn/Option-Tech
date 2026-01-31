import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useDerivativeNetting } from '@/hooks/useDerivativeNetting';
import { useHistoricalData } from '@/hooks/useHistoricalData';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, LogOut, Settings } from 'lucide-react';
import { StatsCards } from '@/components/dashboard/StatsCards';
import { PositionsTable } from '@/components/dashboard/PositionsTable';
import { FileUploader } from '@/components/dashboard/FileUploader';
import { HistoricalDataForm } from '@/components/dashboard/HistoricalDataForm';
import { ViewModeSelector, ViewMode } from '@/components/dashboard/ViewModeSelector';
import { DynamicPortfolioChart } from '@/components/dashboard/DynamicPortfolioChart';
import { formatRelativeTime } from '@/lib/formatters';
import { Link } from 'react-router-dom';

export function Dashboard() {
  const { user, isAdmin, signOut } = useAuth();
  const { portfolio, positions, summary, isLoading } = usePortfolio();
  const netting = useDerivativeNetting(positions, summary);
  const { 
    historicalData, 
    earliestEntry, 
    upsertHistoricalData, 
    deleteHistoricalData,
    isUpserting 
  } = useHistoricalData(portfolio?.id);

  // Centralized state for unified carousel
  const [viewMode, setViewMode] = useState<ViewMode>('base');
  const [selectedHistoricalDate, setSelectedHistoricalDate] = useState<string | null>(
    earliestEntry?.snapshot_date || null
  );

  // Update selected date when earliest entry changes (on first load)
  if (earliestEntry && !selectedHistoricalDate && historicalData.length > 0) {
    setSelectedHistoricalDate(earliestEntry.snapshot_date);
  }

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
                  {portfolio?.name}
                  {portfolio?.last_updated && (
                    <span> • Aggiornato {formatRelativeTime(portfolio.last_updated)}</span>
                  )}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/derivatives">
                  <TrendingUp className="w-4 h-4 mr-2" />
                  Strategie Derivati
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
            viewMode={viewMode}
            historicalData={historicalData}
            selectedHistoricalDate={selectedHistoricalDate}
            onHistoricalDateChange={setSelectedHistoricalDate}
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
              <HistoricalDataForm
                historicalData={historicalData}
                onSave={upsertHistoricalData}
                onDelete={deleteHistoricalData}
                isLoading={isUpserting}
                currentTotalValue={summary?.totalValue ?? 0}
                currentNettingTotal={netting.nettingTotal}
                currentNettingExCC={netting.nettingExCoveredCall}
              />
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
