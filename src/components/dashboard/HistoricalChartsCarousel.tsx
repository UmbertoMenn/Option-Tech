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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { HistoricalDataEntry } from '@/types/historicalData';
import { DepositEntry } from '@/types/deposits';
import { ViewMode } from '@/components/dashboard/ViewModeSelector';
import { NettingViewInfoTooltip } from '@/components/dashboard/NettingViewInfoTooltip';
import { PerformanceEvolutionChart } from './charts/PerformanceEvolutionChart';
import { YearlyReturnChart } from './charts/YearlyReturnChart';
import { PortfolioEvolutionChart } from './charts/PortfolioEvolutionChart';
import { PerformanceAttributionChart } from './charts/PerformanceAttributionChart';
import { TrendingUp, BarChart3, LineChart, ChartNoAxesCombined } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HistoricalChartsCarouselProps {
  portfolioId: string | null;
  historicalData: HistoricalDataEntry[];
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  currentValue: number;
  currentDate: string | null;
  deposits: DepositEntry[];
}

const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  netting_total: 'Netting Totale',
  netting_intrinsic_a: 'Netting Intrinseco (A)',
  netting_intrinsic_b: 'Netting Intrinseco (B)',
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
  {
    id: 'attribution',
    title: 'Scomposizione Rendimento',
    icon: ChartNoAxesCombined,
    description: 'Contributo al rendimento per classe, con premi temporali opzioni separati dall\'intrinseco',
  },
];

export function HistoricalChartsCarousel({
  portfolioId,
  historicalData,
  viewMode,
  onViewModeChange,
  currentValue,
  currentDate,
  deposits,
}: HistoricalChartsCarouselProps) {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);

  // Per i portafogli aggregati mancano ancora snapshot e movimenti consolidati
  // con una chiave comune: l'attribuzione viene quindi mostrata solo sul singolo.
  const activeSlides = portfolioId ? slides : slides.filter(slide => slide.id !== 'attribution');
  const activeSlide = activeSlides[current] ?? activeSlides[0];

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

  // Guardia: se il numero di slide cambia mentre una slide rimossa è selezionata, torna alla prima
  useEffect(() => {
    if (!api) return;
    api.reInit();
    if (api.selectedScrollSnap() >= activeSlides.length) {
      api.scrollTo(0);
      setCurrent(0);
    }
  }, [api, activeSlides.length]);

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
      <Card className="lg:col-span-2 border-border bg-card">
        <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              {(() => {
                const IconComponent = activeSlide.icon;
                return IconComponent ? <IconComponent className="w-5 h-5" /> : null;
              })()}
              {activeSlide.title}
            </CardTitle>
            {activeSlide.id !== 'attribution' && (
              <div className="flex items-center gap-1.5">
                <Select value={viewMode} onValueChange={(v) => onViewModeChange(v as ViewMode)}>
                  <SelectTrigger className="h-7 w-auto text-xs bg-muted border-0 px-2 gap-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="netting_total">Netting Totale</SelectItem>
                    <SelectItem value="netting_intrinsic_a">Netting Intrinseco (A)</SelectItem>
                    <SelectItem value="netting_intrinsic_b">Netting Intrinseco (B)</SelectItem>
                  </SelectContent>
                </Select>
                <NettingViewInfoTooltip />
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{activeSlide.description}</p>
        </CardHeader>
        <CardContent className="pt-0">
          <Carousel setApi={setApi} opts={{ loop: true }} className="w-full">
            <CarouselContent>
              <CarouselItem>
                <div className="h-[250px]">
                  <PerformanceEvolutionChart
                    portfolioId={portfolioId}
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
              {portfolioId && (
                <CarouselItem>
                  <div className="h-[360px]">
                    <PerformanceAttributionChart
                      portfolioId={portfolioId}
                      historicalData={historicalData}
                      deposits={deposits}
                    />
                  </div>
                </CarouselItem>
              )}
            </CarouselContent>
            <div className="flex items-center justify-center gap-4 mt-4">
              <CarouselPrevious className="static translate-y-0" />
              <div className="flex gap-2">
                {activeSlides.map((_, index) => (
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
            <div className="flex items-center gap-1.5">
              <Select value={viewMode} onValueChange={(v) => onViewModeChange(v as ViewMode)}>
                <SelectTrigger className="h-7 w-auto text-xs bg-muted border-0 px-2 gap-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="netting_total">Netting Totale</SelectItem>
                  <SelectItem value="netting_intrinsic_a">Netting Intrinseco (A)</SelectItem>
                  <SelectItem value="netting_intrinsic_b">Netting Intrinseco (B)</SelectItem>
                </SelectContent>
              </Select>
              <NettingViewInfoTooltip />
            </div>
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
