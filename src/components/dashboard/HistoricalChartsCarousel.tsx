import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
  type CarouselApi,
} from '@/components/ui/carousel';
import { HistoricalDataEntry } from '@/types/historicalData';
import { DepositEntry } from '@/types/deposits';
import { ViewMode } from '@/components/dashboard/ViewModeSelector';
import { PerformanceEvolutionChart } from './charts/PerformanceEvolutionChart';
import { YearlyReturnChart } from './charts/YearlyReturnChart';
import { PortfolioEvolutionChart } from './charts/PortfolioEvolutionChart';
import { TrendingUp, BarChart3, LineChart } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HistoricalChartsCarouselProps {
  historicalData: HistoricalDataEntry[];
  viewMode: ViewMode;
  currentValue: number;
  currentDate: string | null;
  deposits: DepositEntry[];
}

const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  base: 'Base',
  netting_total: 'Netting Totale',
  netting_ex_cc: 'Netting ex. CC',
  netting_ex_cc_np: 'Netting ex. CC e NP',
};

const slides = [
  {
    id: 'performance',
    title: 'Evoluzione Rendimento',
    icon: TrendingUp,
    description: 'Rendimento % e P/L nel tempo con confronto annuale',
  },
  {
    id: 'portfolio',
    title: 'Evoluzione Patrimonio',
    icon: LineChart,
    description: 'Andamento valore patrimoniale',
  },
];

export function HistoricalChartsCarousel({
  historicalData,
  viewMode,
  currentValue,
  currentDate,
  deposits,
}: HistoricalChartsCarouselProps) {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);

  const onSelect = useCallback(() => {
    if (!api) return;
    setCurrent(api.selectedScrollSnap());
  }, [api]);

  useEffect(() => {
    if (!api) return;
    onSelect();
    api.on('select', onSelect);
    return () => {
      api.off('select', onSelect);
    };
  }, [api, onSelect]);

  const scrollTo = useCallback(
    (index: number) => {
      api?.scrollTo(index);
    },
    [api]
  );

  if (historicalData.length === 0) {
    return (
      <Card className="lg:col-span-2 border-border bg-card">
        <CardContent className="flex flex-col items-center justify-center h-[300px] text-center">
          <TrendingUp className="w-12 h-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            Nessun dato storico disponibile.
            <br />
            Salva degli snapshot per visualizzare i grafici.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Card Carousel - Evoluzione Rendimento e Patrimonio */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              {(() => {
                const IconComponent = slides[current].icon;
                return IconComponent ? <IconComponent className="w-5 h-5" /> : null;
              })()}
              {slides[current].title}
            </CardTitle>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
              {VIEW_MODE_LABELS[viewMode]}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{slides[current].description}</p>
        </CardHeader>
        <CardContent className="pt-0">
          <Carousel setApi={setApi} opts={{ loop: true }} className="w-full">
            <CarouselContent>
              <CarouselItem>
                <div className="h-[250px]">
                  <PerformanceEvolutionChart
                    historicalData={historicalData}
                    viewMode={viewMode}
                    currentValue={currentValue}
                    currentDate={currentDate}
                    deposits={deposits}
                  />
                </div>
              </CarouselItem>
              <CarouselItem>
                <div className="h-[250px]">
                  <PortfolioEvolutionChart
                    historicalData={historicalData}
                    viewMode={viewMode}
                    currentValue={currentValue}
                    currentDate={currentDate}
                  />
                </div>
              </CarouselItem>
            </CarouselContent>
            <div className="flex items-center justify-center gap-4 mt-4">
              <CarouselPrevious className="static translate-y-0" />
              <div className="flex gap-2">
                {slides.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => scrollTo(index)}
                    className={cn(
                      'w-2 h-2 rounded-full transition-all duration-200',
                      current === index
                        ? 'bg-primary w-4'
                        : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
                    )}
                    aria-label={`Go to slide ${index + 1}`}
                  />
                ))}
              </div>
              <CarouselNext className="static translate-y-0" />
            </div>
          </Carousel>
        </CardContent>
      </Card>

      {/* Card separata - Rendimento per Anno */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Rendimento per Anno
            </CardTitle>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
              {VIEW_MODE_LABELS[viewMode]}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">Rendimento % annuo</p>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-[282px]">
            <YearlyReturnChart
              historicalData={historicalData}
              viewMode={viewMode}
              deposits={deposits}
            />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
