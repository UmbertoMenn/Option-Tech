import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PortfolioSummary, Portfolio, Position } from '@/types/portfolio';
import { NettingResult, NettingBreakdownItem, getBreakdownForViewMode, computeLegDecomposition, STRATEGY_SECTION_LABELS, StrategySectionCategory } from '@/hooks/useDerivativeNetting';
import { NettingLegDetailTable } from '@/components/dashboard/NettingLegDetailTable';
import { DerivativeOverride } from '@/types/derivativeOverrides';
import { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';
import { StrategyConfiguration } from '@/hooks/useStrategyConfigurations';
import { ViewMode } from './ViewModeSelector';
import { Upload, ChevronDown, ChevronUp, AlertTriangle, Settings } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip as RechartsTooltip } from 'recharts';
import { formatEUR } from '@/lib/formatters';
import { useMemo, useState, useCallback, useEffect } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
  type CarouselApi,
} from '@/components/ui/carousel';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { PatrimonyProjectionCard } from '@/components/dashboard/PatrimonyProjectionCard';
import { NettingViewInfoTooltip } from '@/components/dashboard/NettingViewInfoTooltip';
import { useAuth } from '@/contexts/AuthContext';

interface DynamicPortfolioChartProps {
  summary: PortfolioSummary | null;
  portfolio: Portfolio | null;
  positions: Position[];
  netting: NettingResult;
  viewMode: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  overrides?: DerivativeOverride[];
  underlyingPrices?: Record<string, UnderlyingPrice>;
  hasConfigurations?: boolean;
  strategyConfigs?: StrategyConfiguration[];
}

// ─── Colors per strategy section ──────────────────────────────
const SECTION_COLORS: Record<string, string> = {
  covered_call: 'hsl(0, 72%, 51%)',
  derisking_cc: 'hsl(15, 80%, 55%)',
  iron_condor: 'hsl(38, 92%, 50%)',
  double_diagonal: 'hsl(280, 70%, 60%)',
  naked_put: 'hsl(330, 70%, 50%)',
  put_spread: 'hsl(170, 60%, 45%)',
  diagonal_put_spread: 'hsl(240, 60%, 55%)',
  leap_call: 'hsl(160, 60%, 45%)',
  long_put: 'hsl(142, 71%, 45%)',
  other: 'hsl(45, 80%, 55%)',
  orphans: 'hsl(0, 0%, 55%)',
};


// ─── Missing Configuration Warning ───────────────────────────
function MissingConfigWarning() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center h-[220px] gap-3 text-center px-4">
      <AlertTriangle className="w-10 h-10 text-warning" />
      <p className="text-sm text-muted-foreground">
        Nessuna configurazione strategie presente. Configura le strategie per visualizzare il breakdown del netting.
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => navigate('/derivatives')}
        className="gap-2"
      >
        <Settings className="w-4 h-4" />
        Configura strategie
      </Button>
    </div>
  );
}

// ─── Breakdown Bar Chart ──────────────────────────────────────
function NettingBreakdownChart({ items, hasConfigurations }: { items: NettingBreakdownItem[]; hasConfigurations: boolean }) {
  const barData = useMemo(() => {
    return items
      .filter(item => Math.abs(item.value) > 0.01)
      .map(item => ({
        name: STRATEGY_SECTION_LABELS[item.category as StrategySectionCategory] || item.label,
        value: item.value,
        category: item.category,
        fill: SECTION_COLORS[item.category] || 'hsl(var(--muted-foreground))',
        details: item.details
          .slice()
          .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
      }));
  }, [items]);

  const totalDerivatives = useMemo(() => barData.reduce((s, d) => s + d.value, 0), [barData]);

  // Show missing config warning if no configurations exist and we have derivatives
  if (!hasConfigurations) {
    return <MissingConfigWarning />;
  }

  if (barData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[220px] text-muted-foreground text-sm">
        Nessun impatto derivati
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div className="w-full" style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={barData} margin={{ left: 10, right: 10, top: 5, bottom: 60 }}>
            <XAxis
              type="category"
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9 }}
              angle={-35}
              textAnchor="end"
              interval={0}
            />
            <YAxis
              type="number"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
              tickFormatter={(v: number) => {
                const abs = Math.abs(v);
                if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
                if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
                return v.toFixed(0);
              }}
            />
            <RechartsTooltip
              cursor={{ fill: 'hsl(var(--muted-foreground) / 0.08)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-popover border border-border rounded-lg shadow-lg p-2.5 text-sm max-w-xs">
                    <p className="font-semibold text-foreground mb-1">{d.name}</p>
                    <p className={`font-bold mb-1.5 ${d.value < 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {formatEUR(d.value)}
                    </p>
                    {d.details.length > 0 && (
                      <div className="border-t border-border pt-1.5 space-y-0.5">
                        {d.details.map((det: { ticker: string; value: number }, i: number) => (
                          <div key={i} className="flex justify-between gap-3 text-xs">
                            <span className="text-muted-foreground truncate">{det.ticker}</span>
                            <span className={det.value < 0 ? 'text-red-400' : 'text-green-400'}>
                              {formatEUR(det.value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }}
            />
            <Bar dataKey="value" barSize={20} radius={[4, 4, 0, 0]}>
              {barData.map((entry, index) => (
                <Cell key={index} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-2xl font-bold text-blue-500 mt-2">{formatEUR(totalDerivatives)}</p>
    </div>
  );
}

// ─── Top Costose ──────────────────────────────────────────────
function TopCostlyPositions({ items }: { items: NettingBreakdownItem[] }) {
  const [isOpen, setIsOpen] = useState(false);

  const topPositions = useMemo(() => {
    const allDetails = items.flatMap(item =>
      item.details.map(d => ({
        ...d,
        category: item.label,
      }))
    );
    const byTicker = new Map<string, typeof allDetails[0]>();
    for (const d of allDetails) {
      const existing = byTicker.get(d.ticker);
      if (existing) {
        existing.value += d.value;
        existing.strike = undefined;
        existing.expiry = undefined;
      } else {
        byTicker.set(d.ticker, { ...d });
      }
    }
    return [...byTicker.values()]
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 5);
  }, [items]);

  if (topPositions.length === 0) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full justify-center py-2">
        <span>Top posizioni più costose</span>
        {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-1 px-4 pb-2">
          {topPositions.map((pos, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-foreground truncate">{pos.ticker}</span>
                {pos.strike && (
                  <span className="text-muted-foreground">@{pos.strike}</span>
                )}
                {pos.expiry && (
                  <span className="text-muted-foreground">
                    {new Date(pos.expiry).toLocaleDateString('it-IT', { month: 'short', year: '2-digit' })}
                  </span>
                )}
              </div>
              <span className={pos.value < 0 ? 'text-red-400 font-medium' : 'text-green-400 font-medium'}>
                {formatEUR(pos.value)}
              </span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Main Component ───────────────────────────────────────────
const NETTING_DESCRIPTIONS: Record<string, string> = {
  netting_total: 'Valore portafoglio al quale abbiamo sottratto i costi di chiusura di tutte le posizioni in derivati, ai prezzi di mercato.',
  netting_intrinsic_a: 'Valore del portafoglio con tutte le opzioni valutate al solo valore intrinseco: PUT e CALL vendute negative se ITM (zero se OTM), PUT e CALL comprate positive se ITM (zero se OTM).',
  netting_intrinsic_b: 'Valore del portafoglio con PUT e CALL vendute valutate al solo valore intrinseco (negativo se ITM, zero se OTM) e PUT e CALL comprate al valore di mercato.',
};

const CHART_TITLES: Record<ViewMode, string> = {
  netting_total: 'Valore Portafoglio (Netting Totale Derivati)',
  netting_intrinsic_a: 'Valore Portafoglio (Netting Intrinseco A)',
  netting_intrinsic_b: 'Valore Portafoglio (Netting Intrinseco B)',
};


export function DynamicPortfolioChart({ summary, portfolio, positions, netting, viewMode, onViewModeChange, overrides = [], underlyingPrices, hasConfigurations = true, strategyConfigs = [] }: DynamicPortfolioChartProps) {
  const { isAdmin } = useAuth();
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
    return () => { api.off('select', onSelect); };
  }, [api, onSelect]);

  const scrollTo = useCallback((index: number) => { api?.scrollTo(index); }, [api]);

  const { items: breakdownItems, finalValue } = useMemo(() => {
    if (!summary) return { items: [], finalValue: 0 };
    return getBreakdownForViewMode(
      netting.breakdown,
      viewMode,
      positions,
      summary,
      overrides,
      underlyingPrices,
      strategyConfigs,
    );
  }, [viewMode, netting.breakdown, positions, summary, overrides, underlyingPrices, strategyConfigs]);

  const legRows = useMemo(() => {
    return computeLegDecomposition(viewMode, positions, overrides, underlyingPrices, strategyConfigs);
  }, [viewMode, positions, overrides, underlyingPrices, strategyConfigs]);

  const hasDer = positions.some(p => p.asset_type === 'derivative');

  const renderChart = () => {
    if (!summary || positions.length === 0) {
      return (
        <div className="text-center py-12 text-muted-foreground">
          <Upload className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Nessuna posizione presente</p>
          <p className="text-sm">Carica un file Excel per iniziare</p>
        </div>
      );
    }

    // Netting views — carousel
    const baseValue = summary?.totalValue ?? 0;
    const slideCount = isAdmin && viewMode === 'netting_total' ? 3 : 2;

    return (
      <div className="flex flex-col">
        <Carousel setApi={setApi} opts={{ loop: true }} className="w-full">
          <CarouselContent>
            {/* Slide 0 (solo Admin + Netting Totale): proiezione patrimonio alle scadenze */}
            {viewMode === 'netting_total' && isAdmin && (
              <CarouselItem>
                <PatrimonyProjectionCard
                  positions={positions}
                  baseValue={baseValue}
                  underlyingPrices={underlyingPrices}
                  gpEquityValue={Math.max(0, (portfolio?.gp_total_value ?? 0) - (portfolio?.gp_cash_value ?? 0))}
                  derivativesNettingT0={netting.nettingTotal - baseValue}
                />
              </CarouselItem>
            )}
            {/* Slide 1: Dettaglio per gamba (intrinseco + valore temporale) */}
            <CarouselItem>
              <NettingLegDetailTable rows={legRows} viewMode={viewMode} />
            </CarouselItem>
            {/* Slide 2: Breakdown chart */}
            <CarouselItem>
              <NettingBreakdownChart items={breakdownItems} hasConfigurations={hasDer ? hasConfigurations : true} />
            </CarouselItem>
          </CarouselContent>
          <div className="flex items-center justify-center gap-4 mt-2">
            <CarouselPrevious className="static translate-y-0" />
            <div className="flex gap-2">
              {Array.from({ length: slideCount }).map((_, index) => (
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

        <TopCostlyPositions items={breakdownItems} />
      </div>
    );
  };

  return (
    <Card className="lg:col-span-2 border-border bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg">{CHART_TITLES[viewMode]}</CardTitle>
          {onViewModeChange && (
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
      </CardHeader>
      <CardContent>
        {renderChart()}
      </CardContent>
    </Card>
  );
}
