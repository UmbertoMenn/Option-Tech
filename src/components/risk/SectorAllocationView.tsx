import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { 
  Accordion, 
  AccordionContent, 
  AccordionItem, 
  AccordionTrigger 
} from '@/components/ui/accordion';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Building2, TrendingUp, BarChart3, Loader2, CheckCircle2, Info, Pencil, HelpCircle, TrendingDown, DollarSign, Layers } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  SectorExposure, 
  getSectorColor,
  SectorInstrument,
  SectorInstrumentCategory,
} from '@/lib/sectorExposure';
import { formatEUR } from '@/lib/formatters';
import { SectorOverrideDialog } from './SectorOverrideDialog';
import { SectorOverrideData } from '@/hooks/useSectorOverride';
import { 
  StockRiskDetail, 
  NakedPutRiskDetail, 
  LeapCallRiskDetail, 
  StrategyRiskDetail 
} from '@/lib/riskCalculator';

interface SectorAllocationViewProps {
  sectorExposure: SectorExposure[];
  grandTotal: number;
  isLoadingETFData: boolean;
  etfCount: number;
  loadedETFCount: number;
  includeNakedPut: boolean;
  onIncludeNakedPutChange: (value: boolean) => void;
  includeStrategies: boolean;
  onIncludeStrategiesChange: (value: boolean) => void;
  includeLeapCall: boolean;
  onIncludeLeapCallChange: (value: boolean) => void;
  includeGP?: boolean;
  onIncludeGPChange?: (value: boolean) => void;
  isResolvingSectors?: boolean;
  resolvingCount?: number;
  isAdmin?: boolean;
  onRefreshMappings?: () => void;
}

const CATEGORY_CONFIG: Record<SectorInstrumentCategory, { label: string; icon: React.ComponentType<{ className?: string }>; colorClass: string }> = {
  stocks: { label: 'Stocks & ETF', icon: TrendingUp, colorClass: 'text-blue-500' },
  nakedPuts: { label: 'Naked Put', icon: TrendingDown, colorClass: 'text-red-500' },
  leapCalls: { label: 'Leap Call', icon: DollarSign, colorClass: 'text-amber-500' },
  strategies: { label: 'Strategie', icon: Layers, colorClass: 'text-purple-500' },
};

interface InstrumentRowProps {
  instrument: SectorInstrument;
  sectorName: string;
  isAdmin: boolean;
  onOverrideClick: (instrument: SectorInstrument, sector: string) => void;
}

function InstrumentRow({ instrument, sectorName, isAdmin, onOverrideClick }: InstrumentRowProps) {
  const config = CATEGORY_CONFIG[instrument.category];
  const Icon = config.icon;

  return (
    <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Icon className={`w-3.5 h-3.5 ${config.colorClass} flex-shrink-0`} />
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium truncate">{instrument.name}</span>
        </div>
        {instrument.isFromETFDecomposition && instrument.percentage && (
          <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 bg-blue-500/10 text-blue-500 border-blue-500/30">
            {instrument.percentage.toFixed(1)}%
          </Badge>
        )}
        {instrument.isETF && !instrument.isFromETFDecomposition && (
          <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 bg-blue-500/10 text-blue-500 border-blue-500/30">
            ETF
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-sm font-medium">{formatEUR(instrument.riskEUR)}</span>
        {isAdmin && !instrument.isFromETFDecomposition && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              onOverrideClick(instrument, sectorName);
            }}
            title="Modifica settore"
          >
            <Pencil className="w-3 h-3 text-muted-foreground hover:text-foreground" />
          </Button>
        )}
      </div>
    </div>
  );
}

interface CategoryBreakdownProps {
  instruments: SectorInstrument[];
  category: SectorInstrumentCategory;
  total: number;
  sectorName: string;
  isAdmin: boolean;
  onOverrideClick: (instrument: SectorInstrument, sector: string) => void;
}

function CategoryBreakdown({ 
  instruments, 
  category, 
  total,
  sectorName,
  isAdmin,
  onOverrideClick,
}: CategoryBreakdownProps) {
  const categoryInstruments = instruments.filter(i => i.category === category);
  if (categoryInstruments.length === 0) return null;

  // PERF: avoid rendering huge lists
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
            <InstrumentRow 
              key={`${instrument.name}-${idx}`} 
              instrument={instrument}
              sectorName={sectorName}
              isAdmin={isAdmin}
              onOverrideClick={onOverrideClick}
            />
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

export function SectorAllocationView({
  sectorExposure,
  grandTotal,
  isLoadingETFData,
  etfCount,
  loadedETFCount,
  includeNakedPut,
  onIncludeNakedPutChange,
  includeStrategies,
  onIncludeStrategiesChange,
  includeLeapCall,
  onIncludeLeapCallChange,
  includeGP = true,
  onIncludeGPChange,
  isResolvingSectors,
  resolvingCount,
  isAdmin = false,
  onRefreshMappings,
}: SectorAllocationViewProps) {
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [selectedInstrument, setSelectedInstrument] = useState<SectorOverrideData | null>(null);
  
  const handleOpenOverrideDialog = (instrument: SectorInstrument, currentSector: string) => {
    // Extract ticker from name (e.g., "NVIDIA CORP" → "NVDA", "ALPHABET (PUT 180)" → "GOOGL")
    const nameClean = instrument.name.replace(/\s*\([^)]*\)\s*/g, '').trim();
    const tickerMatch = nameClean.match(/^([A-Z]{1,5})(?:\s|$)/);
    
    setSelectedInstrument({
      instrumentName: instrument.name,
      currentSector,
      ticker: tickerMatch?.[1],
    });
    setOverrideDialogOpen(true);
  };
  
  const handleOverrideSuccess = () => {
    onRefreshMappings?.();
  };
  const safeSectorExposure = sectorExposure.filter((s) => {
    return (
      typeof s.sector === 'string' &&
      Number.isFinite(s.totalRisk) &&
      s.totalRisk > 0 &&
      Number.isFinite(s.percentage)
    );
  });

  // Calculate total from displayed sectors to ensure consistency with pie chart
  const displayedGrandTotal = safeSectorExposure.reduce((sum, s) => sum + s.totalRisk, 0);

  const hasData = safeSectorExposure.length > 0 && displayedGrandTotal > 0;
  
  // Prepare chart data
  const chartData = safeSectorExposure.map(s => ({
    name: s.sector,
    value: s.totalRisk,
    percentage: s.percentage,
    color: getSectorColor(s.sector),
  }));

  // State for expandable legend
  const [showAllSectors, setShowAllSectors] = useState(false);

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
                    <Building2 className="w-4 h-4 text-primary" />
                  </div>
                  <span className="text-sm font-medium text-primary">Esposizione Settoriale Totale</span>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="w-4 h-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs text-sm">
                        <p className="mb-2">Usa i toggle per includere/escludere componenti dal totale:</p>
                        <ul className="list-disc ml-4 space-y-1">
                          <li><b>Naked Put</b>: include rischio Naked PUT per settore</li>
                          <li><b>Strategie</b>: include Max Loss delle strategie per settore</li>
                          <li><b>Leap Call</b>: include valore di mercato Leap Call per settore</li>
                        </ul>
                        <p className="mt-2 text-muted-foreground">Commodities, Bond e Protezioni (Long PUT) sono sempre escluse dall'analisi settoriale.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="text-3xl font-bold text-primary">{formatEUR(displayedGrandTotal)}</div>
                {hasData && safeSectorExposure.length > 0 && (
                  <div className="text-sm text-muted-foreground mt-1">
                    Settore principale: <span className="font-medium text-foreground">{safeSectorExposure[0].sector} ({safeSectorExposure[0].percentage.toFixed(1)}%)</span>
                  </div>
                )}
                <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                  <div>
                    {safeSectorExposure.length} settori identificati
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
                  {isResolvingSectors && resolvingCount && resolvingCount > 0 && (
                    <div className="flex items-center gap-1.5 text-blue-500">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Risoluzione AI in corso ({resolvingCount} strumenti)...</span>
                    </div>
                  )}
                  {!isResolvingSectors && !isLoadingETFData && resolvingCount === 0 && (
                    <div className="flex items-center gap-1.5 text-green-500">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Settori aggiornati</span>
                    </div>
                  )}
                </div>
                {/* Info box: esclusioni */}
                <div className="flex items-center gap-2 mt-3 p-2 rounded-md bg-blue-500/10 border border-blue-500/30">
                  <Info className="w-4 h-4 text-blue-500 flex-shrink-0" />
                  <span className="text-xs text-blue-600 dark:text-blue-400">
                    Commodities, Bond e Protezioni (Long Put) escluse dall'analisi settoriale
                  </span>
                </div>
              </div>
              
              {/* Right column: toggles stacked vertically */}
              <div className="flex flex-col gap-2 border-l border-border/50 pl-4">
                <div className="flex items-center gap-2">
                  <Switch id="naked-put-sector-toggle" checked={includeNakedPut} onCheckedChange={onIncludeNakedPutChange} />
                  <Label htmlFor="naked-put-sector-toggle" className="text-sm cursor-pointer">Naked Put</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="strategies-sector-toggle" checked={includeStrategies} onCheckedChange={onIncludeStrategiesChange} />
                  <Label htmlFor="strategies-sector-toggle" className="text-sm cursor-pointer">Strategie</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="leap-call-sector-toggle" checked={includeLeapCall} onCheckedChange={onIncludeLeapCallChange} />
                  <Label htmlFor="leap-call-sector-toggle" className="text-sm cursor-pointer">Leap Call</Label>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Large Thin Donut Chart */}
        <Card className="border-border bg-card">
          <CardContent className="pt-4 pb-4">
            {hasData ? (
              <div className="flex items-center gap-6">
                <div className="w-40 h-40 flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={chartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={70}
                        dataKey="value"
                        nameKey="name"
                        paddingAngle={2}
                        strokeWidth={0}
                      >
                        {chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-1.5">
                  {(showAllSectors ? chartData : chartData.slice(0, 6)).map((sector) => (
                    <div key={sector.name} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: sector.color }}
                        />
                        <span className="truncate max-w-[120px]">{sector.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground text-xs">
                          {sector.percentage.toFixed(1)}%
                        </span>
                        <span className="font-medium min-w-[70px] text-right">
                          {formatEUR(sector.value)}
                        </span>
                      </div>
                    </div>
                  ))}
                  {chartData.length > 6 && (
                    <button
                      onClick={() => setShowAllSectors(!showAllSectors)}
                      className="w-full text-xs text-primary hover:underline pt-2"
                    >
                      {showAllSectors 
                        ? 'Mostra meno' 
                        : `Mostra altri ${chartData.length - 6} settori`}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
                Nessun dato settoriale disponibile
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      
      {/* Sector Details Accordion */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="w-5 h-5 text-primary" />
            Dettaglio per Settore
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" className="space-y-2">
            {safeSectorExposure.map((sector) => (
              <AccordionItem 
                key={sector.sector} 
                value={sector.sector}
                className="border rounded-lg bg-muted/30"
              >
                <AccordionTrigger className="px-4 hover:no-underline">
                  <div className="flex items-center gap-3 flex-1">
                    <div 
                      className="w-4 h-4 rounded-full" 
                      style={{ backgroundColor: getSectorColor(sector.sector) }}
                    />
                    <div className="flex items-center justify-between flex-1 pr-2">
                      <span className="font-semibold">{sector.sector}</span>
                      <div className="text-right flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {sector.instruments.length}
                        </Badge>
                        <span className="text-muted-foreground text-sm">
                          {sector.percentage.toFixed(1)}%
                        </span>
                        <span className="font-semibold" style={{ color: getSectorColor(sector.sector) }}>
                          {formatEUR(sector.totalRisk)}
                        </span>
                      </div>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <Accordion type="multiple" className="space-y-1">
                    {(Object.keys(CATEGORY_CONFIG) as SectorInstrumentCategory[])
                      .map((key) => ({ key, total: sector.breakdown[key] }))
                      .filter((x) => Number.isFinite(x.total) && x.total > 0)
                      .sort((a, b) => b.total - a.total)
                      .map(({ key, total }) => (
                        <CategoryBreakdown
                          key={key}
                          instruments={sector.instruments}
                          category={key}
                          total={total}
                          sectorName={sector.sector}
                          isAdmin={isAdmin}
                          onOverrideClick={handleOpenOverrideDialog}
                        />
                      ))}
                  </Accordion>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
      
      
      {/* Admin Sector Override Dialog */}
      <SectorOverrideDialog
        open={overrideDialogOpen}
        onOpenChange={setOverrideDialogOpen}
        instrumentData={selectedInstrument}
        onSuccess={handleOverrideSuccess}
      />
    </div>
  );
}