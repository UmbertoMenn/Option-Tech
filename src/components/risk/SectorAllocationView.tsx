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
import { Building2, TrendingUp, BarChart3, AlertTriangle, Loader2, CheckCircle2, Info, Pencil } from 'lucide-react';
import { 
  SectorExposure, 
  TopHolding, 
  getSectorColor,
  SectorInstrument,
} from '@/lib/sectorExposure';
import { formatEUR } from '@/lib/formatters';
import { SectorOverrideDialog } from './SectorOverrideDialog';
import { SectorOverrideData } from '@/hooks/useSectorOverride';

interface SectorAllocationViewProps {
  sectorExposure: SectorExposure[];
  topHoldings: TopHolding[];
  grandTotal: number;
  isLoadingETFData: boolean;
  etfCount: number;
  loadedETFCount: number;
  includeDerivatives: boolean;
  onIncludeDerivativesChange: (value: boolean) => void;
  isResolvingSectors?: boolean;
  resolvingCount?: number;
  isAdmin?: boolean;
  onRefreshMappings?: () => void;
}

export function SectorAllocationView({
  sectorExposure,
  topHoldings,
  grandTotal,
  isLoadingETFData,
  etfCount,
  loadedETFCount,
  includeDerivatives,
  onIncludeDerivativesChange,
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

  const hasData = safeSectorExposure.length > 0 && Number.isFinite(grandTotal) && grandTotal > 0;
  
  // Calculate total for sectors other than the top one
  const otherSectorsTotal = useMemo(() => {
    if (safeSectorExposure.length <= 1) return 0;
    return safeSectorExposure.slice(1).reduce((sum, s) => sum + s.totalRisk, 0);
  }, [safeSectorExposure]);
  
  // Prepare chart data
  const chartData = safeSectorExposure.map(s => ({
    name: s.sector,
    value: s.totalRisk,
    percentage: s.percentage,
    color: getSectorColor(s.sector),
  }));

  return (
    <div className="space-y-6">
      {/* Total Exposure Card with Large Donut Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Total Card */}
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded bg-primary/20">
                  <Building2 className="w-4 h-4 text-primary" />
                </div>
                <span className="text-sm font-medium text-primary">Esposizione Settoriale Totale</span>
              </div>
              <div className="flex items-center gap-2">
                <Switch 
                  id="include-derivatives-sector"
                  checked={includeDerivatives}
                  onCheckedChange={onIncludeDerivativesChange}
                />
                <Label htmlFor="include-derivatives-sector" className="text-sm text-muted-foreground cursor-pointer">
                  Includi Derivati
                </Label>
              </div>
            </div>
            <div className="text-3xl font-bold text-primary">{formatEUR(grandTotal)}</div>
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
            {!includeDerivatives && (
              <div className="flex items-center gap-2 mt-3 p-2 rounded-md bg-amber-500/10 border border-amber-500/30">
                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  Derivati esclusi dall'analisi (Naked PUT, Leap Call, Strategie)
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 mt-3 p-2 rounded-md bg-blue-500/10 border border-blue-500/30">
              <Info className="w-4 h-4 text-blue-500 flex-shrink-0" />
              <span className="text-xs text-blue-600 dark:text-blue-400">
                Commodities escluse dall'analisi settoriale
              </span>
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
                <div className="flex-1 space-y-1.5 max-h-40 overflow-y-auto">
                  {chartData.slice(0, 8).map((sector) => (
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
                  {chartData.length > 8 && (
                    <div className="text-xs text-muted-foreground text-center pt-1">
                      +{chartData.length - 8} altri settori
                    </div>
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
          <Accordion type="single" collapsible className="w-full">
            {safeSectorExposure.map((sector) => (
              <AccordionItem key={sector.sector} value={sector.sector} className="border-0">
                <AccordionTrigger className="py-2 px-3 hover:no-underline hover:bg-background/50 rounded-lg">
                  <div className="flex items-center gap-2 flex-1">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: getSectorColor(sector.sector) }}
                    />
                    <span className="text-sm font-medium">{sector.sector}</span>
                    <Badge variant="secondary" className="ml-auto mr-2 text-xs">
                      {sector.instruments.length}
                    </Badge>
                    <span className="text-xs text-muted-foreground mr-2">
                      {sector.percentage.toFixed(1)}%
                    </span>
                    <span className="font-medium text-sm" style={{ color: getSectorColor(sector.sector) }}>
                      {formatEUR(sector.totalRisk)}
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-1 pb-2 px-2">
                  <div className="space-y-1 pl-4">
                    {sector.instruments.map((instrument, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {instrument.isETF ? (
                            <BarChart3 className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                          ) : (
                            <TrendingUp className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                          )}
                          <span className="text-sm truncate">{instrument.name}</span>
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
                          <span className="text-sm font-medium">
                            {formatEUR(instrument.riskEUR)}
                          </span>
                          {isAdmin && !instrument.isFromETFDecomposition && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenOverrideDialog(instrument, sector.sector);
                              }}
                              title="Modifica settore"
                            >
                              <Pencil className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
      
      {/* Top 20 Holdings */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="w-5 h-5 text-primary" />
            Top 20 Holdings
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topHoldings.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              {isLoadingETFData ? (
                <span className="animate-pulse">Caricamento dati holdings ETF...</span>
              ) : (
                <span>Nessun dato disponibile sui top holdings degli ETF</span>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {topHoldings.map((holding, index) => (
                <div
                  key={holding.name}
                  className="flex items-center justify-between p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="text-sm font-medium text-muted-foreground w-6 text-right">
                      {index + 1}.
                    </span>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium truncate">{holding.name}</span>
                      <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                        {holding.sources.slice(0, 3).map((source, idx) => (
                          <span key={idx}>
                            {source.isDirectHolding ? (
                              <Badge variant="outline" className="text-xs px-1 py-0 h-4 bg-green-500/10 text-green-500 border-green-500/30">
                                Diretto
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">
                                via {source.source.length > 20 ? source.source.substring(0, 20) + '...' : source.source}
                                {source.percentage ? ` (${source.percentage.toFixed(1)}%)` : ''}
                              </span>
                            )}
                            {idx < Math.min(2, holding.sources.length - 1) && ', '}
                          </span>
                        ))}
                        {holding.sources.length > 3 && (
                          <span>+{holding.sources.length - 3} altri</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {holding.percentage.toFixed(1)}%
                    </span>
                    <span className="text-sm font-medium text-primary min-w-[80px] text-right">
                      {formatEUR(holding.totalExposure)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
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
