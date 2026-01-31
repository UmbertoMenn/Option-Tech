import { useAuth } from '@/contexts/AuthContext';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useDerivativeNetting } from '@/hooks/useDerivativeNetting';
import { useHistoricalData } from '@/hooks/useHistoricalData';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, LogOut, Settings, Upload } from 'lucide-react';
import { PortfolioDonutChart } from '@/components/dashboard/PortfolioDonutChart';
import { AssetAllocationLegend } from '@/components/dashboard/AssetAllocationLegend';
import { StatsCards } from '@/components/dashboard/StatsCards';
import { PositionsTable } from '@/components/dashboard/PositionsTable';
import { FileUploader } from '@/components/dashboard/FileUploader';
import { HistoricalDataForm } from '@/components/dashboard/HistoricalDataForm';
import { formatCurrency } from '@/lib/formatters';
import { formatRelativeTime } from '@/lib/formatters';
import { Link } from 'react-router-dom';
import useEmblaCarousel from 'embla-carousel-react';
import { useCallback, useEffect, useState } from 'react';
import { PortfolioSummary, Portfolio, Position } from '@/types/portfolio';
import { cn } from '@/lib/utils';
import { NettingResult } from '@/hooks/useDerivativeNetting';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, LabelList } from 'recharts';

interface PortfolioCarouselProps {
  summary: PortfolioSummary | null;
  portfolio: Portfolio | null;
  positions: Position[];
  netting: NettingResult;
}

interface NettingChartProps {
  baseValue: number;
  nettedValue: number;
  label: string;
}

function NettingChart({ baseValue, nettedValue, label }: NettingChartProps) {
  const data = [
    { name: 'Valore Asset Portafoglio', value: baseValue, fill: 'hsl(var(--muted-foreground))' },
    { name: label, value: nettedValue, fill: 'hsl(217, 91%, 60%)' },
  ];

  const formatValue = (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M $`;
    if (value >= 1000) return `${(value / 1000).toFixed(0)}K $`;
    return `${value.toFixed(0)} $`;
  };

  return (
    <div className="flex flex-col items-center py-4">
      <div className="w-full h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 20, right: 80, top: 10, bottom: 10 }}>
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis 
              type="category" 
              dataKey="name" 
              axisLine={false} 
              tickLine={false}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              width={140}
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={32}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
              <LabelList 
                dataKey="value" 
                position="right" 
                formatter={formatValue}
                style={{ fill: 'hsl(var(--foreground))', fontSize: 12, fontWeight: 500 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 text-center">
        <p className="text-2xl font-bold text-blue-500">
          {formatCurrency(nettedValue)}
        </p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function PortfolioCarousel({ summary, portfolio, positions, netting }: PortfolioCarouselProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false });
  const [selectedIndex, setSelectedIndex] = useState(0);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on('select', onSelect);
    return () => {
      emblaApi.off('select', onSelect);
    };
  }, [emblaApi, onSelect]);

  const scrollTo = useCallback((index: number) => {
    if (emblaApi) emblaApi.scrollTo(index);
  }, [emblaApi]);

  const slides = [
    { title: 'Composizione Portafoglio (Derivati esclusi)', id: 'composition' },
    { title: 'Valore Portafoglio (Netting ex. Covered Call)', id: 'netting-ex-cc' },
    { title: 'Valore Portafoglio (Netting Totale Derivati)', id: 'netting-total' },
  ];

  return (
    <Card className="lg:col-span-2 border-border bg-card overflow-hidden">
      <CardHeader className="flex flex-col items-center gap-2 pb-2">
        {/* Dot indicators */}
        <div className="flex gap-2">
          {slides.map((_, index) => (
            <button
              key={index}
              onClick={() => scrollTo(index)}
              className={cn(
                "w-2 h-2 rounded-full transition-colors",
                selectedIndex === index
                  ? "bg-primary"
                  : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
              )}
              aria-label={`Vai alla slide ${index + 1}`}
            />
          ))}
        </div>
        <CardTitle className="text-lg text-center">{slides[selectedIndex].title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden" ref={emblaRef}>
          <div className="flex">
            {/* Slide 1: Composizione Portafoglio */}
            <div className="flex-[0_0_100%] min-w-0">
              {summary && positions.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <PortfolioDonutChart summary={summary} portfolio={portfolio} />
                  <AssetAllocationLegend summary={summary} />
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Upload className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Nessuna posizione presente</p>
                  <p className="text-sm">Carica un file Excel per iniziare</p>
                </div>
              )}
            </div>

            {/* Slide 2: Netting ex. Covered Call */}
            <div className="flex-[0_0_100%] min-w-0">
              <NettingChart
                baseValue={summary?.totalValue ?? 0}
                nettedValue={netting.nettingExCoveredCall}
                label="Netting ex. CC & Protezioni"
              />
            </div>

            {/* Slide 3: Netting Totale Derivati */}
            <div className="flex-[0_0_100%] min-w-0">
              <NettingChart
                baseValue={summary?.totalValue ?? 0}
                nettedValue={netting.nettingTotal}
                label="Netting Totale"
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

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
        {/* Stats */}
        {summary && (
          <StatsCards 
            summary={summary} 
            portfolio={portfolio}
            nettingTotal={netting.nettingTotal}
            nettingExCC={netting.nettingExCoveredCall}
            earliestHistoricalData={earliestEntry}
          />
        )}

        {/* Main content grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Portfolio Chart Carousel */}
          <PortfolioCarousel summary={summary} portfolio={portfolio} positions={positions} netting={netting} />

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
