import { useAuth } from '@/contexts/AuthContext';
import { usePortfolio } from '@/hooks/usePortfolio';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, LogOut, Settings, Upload } from 'lucide-react';
import { PortfolioDonutChart } from '@/components/dashboard/PortfolioDonutChart';
import { AssetAllocationLegend } from '@/components/dashboard/AssetAllocationLegend';
import { StatsCards } from '@/components/dashboard/StatsCards';
import { PositionsTable } from '@/components/dashboard/PositionsTable';
import { FileUploader } from '@/components/dashboard/FileUploader';
import { InitialValueForm } from '@/components/dashboard/InitialValueForm';
import { formatRelativeTime } from '@/lib/formatters';
import { Link } from 'react-router-dom';
import useEmblaCarousel from 'embla-carousel-react';
import { useCallback, useEffect, useState } from 'react';
import { PortfolioSummary, Portfolio, Position } from '@/types/portfolio';
import { cn } from '@/lib/utils';

interface PortfolioCarouselProps {
  summary: PortfolioSummary | null;
  portfolio: Portfolio | null;
  positions: Position[];
}

function PortfolioCarousel({ summary, portfolio, positions }: PortfolioCarouselProps) {
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
    { title: 'Valore Portafoglio (Netting Totale Derivati)', id: 'netting-total' },
    { title: 'Valore Portafoglio (Netting ex. Covered Call)', id: 'netting-ex-cc' },
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

            {/* Slide 2: Netting Totale Derivati */}
            <div className="flex-[0_0_100%] min-w-0">
              <div className="text-center py-12 text-muted-foreground">
                <p className="text-lg font-medium">Valore Portafoglio (Netting Totale Derivati)</p>
                <p className="text-sm mt-2">Contenuto in arrivo...</p>
              </div>
            </div>

            {/* Slide 3: Netting ex. Covered Call */}
            <div className="flex-[0_0_100%] min-w-0">
              <div className="text-center py-12 text-muted-foreground">
                <p className="text-lg font-medium">Valore Portafoglio (Netting ex. Covered Call)</p>
                <p className="text-sm mt-2">Contenuto in arrivo...</p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const { user, isAdmin, signOut } = useAuth();
  const { portfolio, positions, summary, isLoading, updateInitialValue, isUpdatingInitialValue } = usePortfolio();

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
        {summary && <StatsCards summary={summary} portfolio={portfolio} />}

        {/* Main content grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Portfolio Chart Carousel */}
          <PortfolioCarousel summary={summary} portfolio={portfolio} positions={positions} />

          {/* File Upload & Initial Value */}
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Dati Patrimonio</h3>
              <InitialValueForm
                initialValue={portfolio?.initial_value ?? null}
                initialDate={portfolio?.initial_date ?? null}
                deposits={portfolio?.deposits ?? null}
                averageBalance={portfolio?.average_balance ?? null}
                averageBalanceDate={portfolio?.average_balance_date ?? null}
                onSave={(data) => updateInitialValue(data)}
                isLoading={isUpdatingInitialValue}
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
