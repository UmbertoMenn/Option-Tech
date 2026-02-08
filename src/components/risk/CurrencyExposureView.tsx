import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  Accordion, 
  AccordionContent, 
  AccordionItem, 
  AccordionTrigger 
} from '@/components/ui/accordion';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Coins, TrendingUp, BarChart3, TrendingDown, DollarSign, Layers, ExternalLink, AlertTriangle, Landmark, Info, ShieldCheck, HelpCircle } from 'lucide-react';
import { CurrencyExposure, getCurrencyColor, InstrumentDetail } from '@/lib/currencyExposure';
import { formatEUR, formatCurrency } from '@/lib/formatters';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface CurrencyExposureViewProps {
  currencyExposure: CurrencyExposure[];
  grandTotal: number;
  isLoadingETFData?: boolean;
  etfCount?: number;
  loadedETFCount?: number;
  includeBonds: boolean;
  onIncludeBondsChange: (value: boolean) => void;
  includeProtections: boolean;
  onIncludeProtectionsChange: (value: boolean) => void;
  includeNakedPut: boolean;
  onIncludeNakedPutChange: (value: boolean) => void;
  includeStrategies: boolean;
  onIncludeStrategiesChange: (value: boolean) => void;
  includeLeapCall: boolean;
  onIncludeLeapCallChange: (value: boolean) => void;
}

const CATEGORY_CONFIG = {
  stocks: { label: 'Stocks & ETF', icon: TrendingUp, colorClass: 'text-blue-500' },
  bonds: { label: 'Obbligazioni', icon: Landmark, colorClass: 'text-cyan-500' },
  commodities: { label: 'Commodities', icon: BarChart3, colorClass: 'text-orange-500' },
  protections: { label: 'Protezioni (Long Put)', icon: ShieldCheck, colorClass: 'text-emerald-500' },
  nakedPuts: { label: 'Naked Put', icon: TrendingDown, colorClass: 'text-red-500' },
  leapCalls: { label: 'Leap Call', icon: DollarSign, colorClass: 'text-amber-500' },
  strategies: { label: 'Strategie', icon: Layers, colorClass: 'text-purple-500' },
};

type CategoryKey = keyof typeof CATEGORY_CONFIG;

function InstrumentRow({ instrument }: { instrument: InstrumentDetail }) {
  const config = CATEGORY_CONFIG[instrument.category];
  const Icon = config.icon;
  
  const handleJustETFClick = () => {
    // Try to find ISIN in the name or use the name as search
    const searchTerm = instrument.name.replace(/\s+/g, '+');
    window.open(`https://www.justetf.com/en/find-etf.html?query=${searchTerm}`, '_blank');
  };
  
  return (
    <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Icon className={`w-3.5 h-3.5 ${config.colorClass} flex-shrink-0`} />
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{instrument.name}</span>
            {instrument.isETF && (
              <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 bg-blue-500/10 text-blue-500 border-blue-500/30">
                ETF
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground truncate">{instrument.details}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="font-medium text-sm">{formatEUR(instrument.riskEUR)}</span>
        {instrument.isETF && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-primary"
            onClick={handleJustETFClick}
            title="Cerca su justETF"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function CategoryBreakdown({ 
  instruments, 
  category, 
  total 
}: { 
  instruments: InstrumentDetail[]; 
  category: keyof typeof CATEGORY_CONFIG;
  total: number;
}) {
  const categoryInstruments = instruments.filter(i => i.category === category);
  if (categoryInstruments.length === 0) return null;

  // PERF: avoid rendering huge lists (can freeze the UI / blank screen)
  const DEFAULT_LIMIT = 25;
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? categoryInstruments : categoryInstruments.slice(0, DEFAULT_LIMIT);
  const hiddenCount = Math.max(0, categoryInstruments.length - visible.length);
  
  const config = CATEGORY_CONFIG[category];
  const Icon = config.icon;
  
  return (
    <AccordionItem value={category} className="border-0">
      <AccordionTrigger className="py-2 px-3 hover:no-underline hover:bg-background/50 rounded-lg">
        <div className="flex items-center gap-2 flex-1">
          <Icon className={`w-4 h-4 ${config.colorClass}`} />
          <span className="text-sm">{config.label}</span>
          <Badge variant="secondary" className="ml-auto mr-2 text-xs">
            {categoryInstruments.length}
          </Badge>
          <span className="font-medium text-sm">{formatEUR(total)}</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pt-1 pb-2 px-2">
        <div className="space-y-1">
          {visible.map((instrument, idx) => (
            <InstrumentRow key={`${instrument.name}-${idx}`} instrument={instrument} />
          ))}

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(v => !v)}
              className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-2"
            >
              {showAll ? 'Mostra meno' : `Mostra altri ${hiddenCount}...`}
            </button>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

export function CurrencyExposureView({ 
  currencyExposure, 
  grandTotal,
  isLoadingETFData = false,
  etfCount = 0,
  loadedETFCount = 0,
  includeBonds,
  onIncludeBondsChange,
  includeProtections,
  onIncludeProtectionsChange,
  includeNakedPut,
  onIncludeNakedPutChange,
  includeStrategies,
  onIncludeStrategiesChange,
  includeLeapCall,
  onIncludeLeapCallChange
}: CurrencyExposureViewProps) {
  const safeCurrencyExposure = currencyExposure.filter((c) => {
    return (
      typeof c.currency === 'string' &&
      Number.isFinite(c.totalRisk) &&
      c.totalRisk > 0 &&
      Number.isFinite(c.percentage)
    );
  });

  const hasData = safeCurrencyExposure.length > 0 && Number.isFinite(grandTotal) && grandTotal > 0;

  const nonEurTotal = useMemo(() => {
    return safeCurrencyExposure
      .filter((c) => c.currency !== 'EUR')
      .reduce((sum, c) => sum + c.totalRisk, 0);
  }, [safeCurrencyExposure]);
  
  // Group currencies beyond top 5 into "OTHER" for chart display
  const MAX_CURRENCIES_IN_CHART = 5;
  const chartData = useMemo(() => {
    // First, check if we even need to group
    if (safeCurrencyExposure.length <= MAX_CURRENCIES_IN_CHART) {
      return safeCurrencyExposure.map((c, idx) => ({ ...c, chartKey: `${c.currency}-${idx}` }));
    }
    
    // Check if "OTHER" already exists in top currencies
    const otherIndex = safeCurrencyExposure.findIndex(c => c.currency === 'OTHER');
    
    // Get top currencies (excluding OTHER if it exists, we'll handle it separately)
    const currenciesWithoutOther = safeCurrencyExposure.filter(c => c.currency !== 'OTHER');
    const existingOther = otherIndex >= 0 ? safeCurrencyExposure[otherIndex] : null;
    
    const topCurrencies = currenciesWithoutOther.slice(0, MAX_CURRENCIES_IN_CHART - (existingOther ? 1 : 0));
    const currenciesToGroup = currenciesWithoutOther.slice(MAX_CURRENCIES_IN_CHART - (existingOther ? 1 : 0));
    
    // Calculate totals for grouped currencies
    const groupedTotal = currenciesToGroup.reduce((sum, c) => sum + c.totalRisk, 0);
    const groupedPercentage = currenciesToGroup.reduce((sum, c) => sum + c.percentage, 0);
    
    // Merge with existing OTHER or create new OTHER
    const otherTotalRisk = (existingOther?.totalRisk || 0) + groupedTotal;
    const otherPercentage = (existingOther?.percentage || 0) + groupedPercentage;
    
    // Only add OTHER if there's something to show
    if (otherTotalRisk <= 0) {
      return topCurrencies.map((c, idx) => ({ ...c, chartKey: `${c.currency}-${idx}` }));
    }
    
    return [
      ...topCurrencies.map((c, idx) => ({ ...c, chartKey: `${c.currency}-${idx}` })),
      {
        currency: 'OTHER',
        totalRisk: otherTotalRisk,
        totalRiskOriginal: otherTotalRisk,
        percentage: otherPercentage,
        breakdown: existingOther?.breakdown || { stocks: 0, bonds: 0, commodities: 0, protections: 0, nakedPuts: 0, leapCalls: 0, strategies: 0 },
        instruments: existingOther?.instruments || [],
        chartKey: 'OTHER-grouped'
      }
    ];
  }, [safeCurrencyExposure]);

  return (
    <div className="space-y-6">
      {/* Total Exposure Card with Large Donut Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Total Card */}
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex justify-between gap-4">
              {/* Left column: title, value, description */}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-1.5 rounded bg-primary/20">
                    <Coins className="w-4 h-4 text-primary" />
                  </div>
                  <span className="text-sm font-medium text-primary">Esposizione Valutaria Totale</span>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="w-4 h-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs text-sm">
                        <p className="mb-2">Usa i toggle per includere/escludere componenti dal totale:</p>
                        <ul className="list-disc ml-4 space-y-1">
                          <li><b>Bond</b>: include obbligazioni nell'esposizione</li>
                          <li><b>Protezioni</b>: include Long PUT (valorizzate a mercato)</li>
                          <li><b>Naked Put</b>: include rischio Naked PUT</li>
                          <li><b>Strategie</b>: include Max Loss delle strategie</li>
                          <li><b>Leap Call</b>: include valore di mercato Leap Call</li>
                        </ul>
                        <p className="mt-2 text-muted-foreground">Le azioni sono sempre valorizzate al lordo delle protezioni.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="text-3xl font-bold text-primary">{formatEUR(grandTotal)}</div>
                {hasData && (
                  <div className="text-sm text-muted-foreground mt-1">
                    Non-EUR totale: <span className="font-medium text-foreground">{formatEUR(nonEurTotal)}</span>
                  </div>
                )}
                <div className="text-xs text-muted-foreground mt-1">
                  Rischio aggregato per valuta
                  {isLoadingETFData && (
                    <span className="ml-2 text-primary animate-pulse">
                      Caricamento dati ETF ({loadedETFCount}/{etfCount})...
                    </span>
                  )}
                  {!isLoadingETFData && etfCount > 0 && (
                    <span className="ml-2 text-green-500">
                      ✓ {loadedETFCount} ETF analizzati
                    </span>
                  )}
                </div>
              </div>
              
              {/* Right column: toggles stacked vertically */}
              <div className="flex flex-col gap-2 border-l border-border/50 pl-4">
                <div className="flex items-center gap-2">
                  <Switch id="bonds-toggle" checked={includeBonds} onCheckedChange={onIncludeBondsChange} />
                  <Label htmlFor="bonds-toggle" className="text-sm cursor-pointer">Bond</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="protections-toggle" checked={includeProtections} onCheckedChange={onIncludeProtectionsChange} />
                  <Label htmlFor="protections-toggle" className="text-sm cursor-pointer">Protezioni</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="naked-put-toggle" checked={includeNakedPut} onCheckedChange={onIncludeNakedPutChange} />
                  <Label htmlFor="naked-put-toggle" className="text-sm cursor-pointer">Naked Put</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="strategies-toggle" checked={includeStrategies} onCheckedChange={onIncludeStrategiesChange} />
                  <Label htmlFor="strategies-toggle" className="text-sm cursor-pointer">Strategie</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="leap-call-toggle" checked={includeLeapCall} onCheckedChange={onIncludeLeapCallChange} />
                  <Label htmlFor="leap-call-toggle" className="text-sm cursor-pointer">Leap Call</Label>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Large Thin Donut Chart */}
        <Card className="border-border bg-card">
          <CardContent className="pt-6">
            {hasData ? (
              <div className="flex items-center gap-6">
                <div className="w-40 h-40 flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={chartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={75}
                        paddingAngle={2}
                        dataKey="totalRisk"
                      >
                        {chartData.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={getCurrencyColor(entry.currency)}
                          />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-2">
                  {chartData.map((curr) => (
                    <div key={curr.chartKey} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: getCurrencyColor(curr.currency) }}
                        />
                        <span className="font-medium">{curr.currency}</span>
                      </div>
                      <div className="text-right flex flex-col">
                        <div className="flex items-center gap-2 justify-end">
                          <span className="font-medium">{curr.percentage.toFixed(1)}%</span>
                          <span className="text-muted-foreground text-xs">
                            {formatEUR(curr.totalRisk)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-40 text-muted-foreground">
                Nessun dato disponibile
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Currency Breakdown Accordion with Instrument Details */}
      {hasData && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Dettaglio per Valuta</CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" className="space-y-2">
              {safeCurrencyExposure.map((curr) => (
                <AccordionItem 
                  key={curr.currency} 
                  value={curr.currency}
                  className="border rounded-lg bg-muted/30"
                >
                  <AccordionTrigger className="px-4 hover:no-underline">
                    <div className="flex items-center gap-3 flex-1">
                      <div 
                        className="w-4 h-4 rounded-full" 
                        style={{ backgroundColor: getCurrencyColor(curr.currency) }}
                      />
                      <div className="flex items-center justify-between flex-1 pr-2">
                        <span className="font-semibold">{curr.currency}</span>
                        <div className="text-right flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {curr.instruments.length} strumenti
                          </Badge>
                          <span className="font-semibold">{formatEUR(curr.totalRisk)}</span>
                          <span className="text-muted-foreground text-sm">
                            ({curr.percentage.toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    <Accordion type="multiple" className="space-y-1">
                      {(Object.keys(CATEGORY_CONFIG) as CategoryKey[])
                        .map((key) => ({ key, total: curr.breakdown[key] }))
                        .filter((x) => Number.isFinite(x.total) && x.total > 0)
                        .sort((a, b) => b.total - a.total)
                        .map(({ key, total }) => (
                          <CategoryBreakdown
                            key={key}
                            instruments={curr.instruments}
                            category={key}
                            total={total}
                          />
                        ))}
                    </Accordion>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!hasData && (
        <Card className="border-border bg-card">
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <Coins className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="font-medium">Nessuna esposizione valutaria</p>
              <p className="text-sm">Carica un portfolio per visualizzare l'analisi</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
