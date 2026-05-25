import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  Accordion, 
  AccordionContent, 
  AccordionItem, 
  AccordionTrigger 
} from '@/components/ui/accordion';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { HelpCircle, Loader2, ChevronRight, Info } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { 
  ShieldAlert, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  BarChart3, 
  Shield, 
  AlertTriangle,
  Layers
} from 'lucide-react';
import { RiskAnalysis } from '@/lib/riskCalculator';
import { formatEUR, formatNumber } from '@/lib/formatters';
import { ETFAllocation } from '@/hooks/useETFAllocations';
import { calculateConsolidatedTopHoldings, ConsolidatedHoldingWithDetails } from '@/lib/sectorExposure';
import { HoldingBreakdownDialog } from './HoldingBreakdownDialog';
import { GPHoldingRow } from '@/hooks/useGPHoldings';
import { useUnderlyingMappings } from '@/hooks/useUnderlyingMappings';
import { buildDynamicAliasMap } from '@/lib/tickerIdentity';

interface EquityExposureViewProps {
  analysis: RiskAnalysis;
  portfolioTotalValue?: number;
  etfAllocations?: Record<string, ETFAllocation>;
  isLoadingETFData?: boolean;
  gpStockHoldings?: GPHoldingRow[];
  includeGP?: boolean;
  onIncludeGPChange?: (value: boolean) => void;
}

function CalcInfo({ children, className = 'w-3.5 h-3.5' }: { children: React.ReactNode; className?: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center align-middle text-muted-foreground hover:text-foreground"
            aria-label="Spiegazione calcolo"
          >
            <Info className={className} />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm">
          <div className="text-xs whitespace-pre-wrap leading-relaxed font-mono">{children}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function EquityExposureView({ 
  analysis, 
  portfolioTotalValue,
  etfAllocations = {},
  isLoadingETFData = false,
  gpStockHoldings = [],
  includeGP = true,
  onIncludeGPChange,
}: EquityExposureViewProps) {
  const [includeProtections, setIncludeProtections] = useState(true);
  const [includeNakedPut, setIncludeNakedPut] = useState(true);
  const [includeStrategies, setIncludeStrategies] = useState(true);
  const [includeLeapCall, setIncludeLeapCall] = useState(true);
  const [includeSynthCcDrcc, setIncludeSynthCcDrcc] = useState(true);
  const [selectedHolding, setSelectedHolding] = useState<ConsolidatedHoldingWithDetails | null>(null);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  
  const {
    totalStockRisk,
    totalETFRisk,
    totalPureStockRisk,
    totalCommodityRisk,
    totalBondRisk,
    totalNakedPutRisk,
    totalLeapCallRisk,
    totalStrategyRisk,
    totalSyntheticCcDrccRisk,
    grandTotal,
    stockDetails,
    syntheticCcDrccDetails,
    commodityDetails,
    nakedPutDetails,
    leapCallDetails,
    strategyDetails
  } = analysis;
  
  // Backend underlying_mappings → dynamic alias map (CEG, APP, RDDT, CLS, ...)
  const { allMappings } = useUnderlyingMappings();
  const dynamicAliases = useMemo(
    () => buildDynamicAliasMap(allMappings.data || []),
    [allMappings.data],
  );

  // Calculate all consolidated holdings (no limit) - include GP stocks
  const consolidatedHoldings = useMemo(() => {
    return calculateConsolidatedTopHoldings(analysis, etfAllocations, { 
      includeProtections,
      includeNakedPut,
      includeStrategies,
      includeLeapCall
    }, 100, includeGP ? gpStockHoldings : [], dynamicAliases);
  }, [analysis, etfAllocations, includeProtections, includeNakedPut, includeStrategies, includeLeapCall, includeGP, gpStockHoldings, dynamicAliases]);

  // Calculate gross stock risk and protection savings
  const { grossPureStockRisk, protectionSavings } = useMemo(() => {
    const pureStocks = stockDetails.filter(s => !s.isETF);
    
    // Gross = stock value without considering protections
    const gross = pureStocks.reduce((sum, s) => 
      sum + (s.stockValue / s.exchangeRate), 0
    );
    
    // Net = current risk (already net of protections)
    const net = pureStocks.reduce((sum, s) => sum + s.riskEUR, 0);
    
    return {
      grossPureStockRisk: gross,
      protectionSavings: gross - net
    };
  }, [stockDetails]);

  // GP stock total value
  const gpStockTotalValue = useMemo(() => 
    gpStockHoldings.reduce((sum, h) => sum + h.market_value, 0),
    [gpStockHoldings]
  );

  // Dynamic grand total based on toggles
  const dynamicGrandTotal = useMemo(() => {
    const stockRisk = includeProtections ? totalPureStockRisk : grossPureStockRisk;
    return (
      totalETFRisk + 
      stockRisk + 
      totalCommodityRisk + 
      (includeNakedPut ? totalNakedPutRisk : 0) + 
      (includeLeapCall ? totalLeapCallRisk : 0) + 
      (includeStrategies ? totalStrategyRisk : 0) +
      (includeSynthCcDrcc ? totalSyntheticCcDrccRisk : 0) +
      (includeGP ? gpStockTotalValue : 0)
    );
  }, [
    includeProtections, 
    includeNakedPut, 
    includeLeapCall, 
    includeStrategies,
    includeSynthCcDrcc,
    includeGP,
    totalETFRisk, 
    totalPureStockRisk, 
    grossPureStockRisk, 
    totalCommodityRisk, 
    totalNakedPutRisk, 
    totalLeapCallRisk, 
    totalStrategyRisk,
    totalSyntheticCcDrccRisk,
    gpStockTotalValue,
  ]);

  const getPercentage = (value: number) => dynamicGrandTotal > 0 ? (value / dynamicGrandTotal) * 100 : 0;
  
  // Percentuale rischio Naked PUT rispetto ai Bond
  const nakedPutVsBondPct = totalBondRisk > 0 
    ? (totalNakedPutRisk / totalBondRisk) * 100 
    : null;

  // Separate ETF and pure stock details
  const etfDetails = stockDetails.filter(s => s.isETF);
  const pureStockDetails = stockDetails.filter(s => !s.isETF);

  // Dynamic stock risk value based on toggle
  const displayedStockRisk = includeProtections ? totalPureStockRisk : grossPureStockRisk;

  // Sorted arrays for consistent descending order display
  const sortedETFDetails = useMemo(() => 
    [...etfDetails].sort((a, b) => b.riskEUR - a.riskEUR),
    [etfDetails]
  );

  // Sort by gross value; for synthetics (stockValue=0) fall back to riskEUR so they don't sink to the bottom.
  const sortedPureStockDetails = useMemo(() => 
    [...pureStockDetails].sort((a, b) => {
      const va = a.isSynthetic ? a.riskEUR : a.stockValue / a.exchangeRate;
      const vb = b.isSynthetic ? b.riskEUR : b.stockValue / b.exchangeRate;
      return vb - va;
    }),
    [pureStockDetails]
  );

  const sortedCommodityDetails = useMemo(() => 
    [...commodityDetails].sort((a, b) => b.riskEUR - a.riskEUR),
    [commodityDetails]
  );

  const sortedNakedPutDetails = useMemo(() => 
    [...nakedPutDetails].sort((a, b) => b.riskEUR - a.riskEUR),
    [nakedPutDetails]
  );

  const sortedLeapCallDetails = useMemo(() => 
    [...leapCallDetails].sort((a, b) => b.riskEUR - a.riskEUR),
    [leapCallDetails]
  );

  const sortedStrategyDetails = useMemo(() => 
    [...strategyDetails].sort((a, b) => b.maxLossEUR - a.maxLossEUR),
    [strategyDetails]
  );

  const sortedSyntheticCcDrccDetails = useMemo(() => 
    [...syntheticCcDrccDetails].sort((a, b) => b.riskEUR - a.riskEUR),
    [syntheticCcDrccDetails]
  );

  // Sort by totalExposure (already accounts for active toggles) in descending order
  const sortedConsolidatedHoldings = useMemo(() => 
    [...consolidatedHoldings].sort((a, b) => {
      return Math.abs(b.totalExposure) - Math.abs(a.totalExposure);
    }),
    [consolidatedHoldings]
  );

  const riskCategories = [
    { 
      label: 'Rischio ETF Azionari', 
      value: totalETFRisk, 
      sortValue: totalETFRisk,
      percentage: getPercentage(totalETFRisk),
      color: 'bg-cyan-500',
      icon: TrendingUp,
      description: 'ETF azionari',
      protectionSavings: 0,
      showProtectionSavings: false
    },
    { 
      label: 'Rischio Stocks', 
      value: displayedStockRisk, 
      sortValue: grossPureStockRisk,
      percentage: getPercentage(displayedStockRisk),
      color: 'bg-blue-500',
      icon: TrendingUp,
      description: includeProtections 
        ? 'Azioni individuali (al netto di protezioni PUT)' 
        : 'Azioni individuali (al lordo di protezioni PUT)',
      protectionSavings: includeProtections ? protectionSavings : 0,
      showProtectionSavings: includeProtections && protectionSavings > 0
    },
    { 
      label: 'Rischio Commodities', 
      value: totalCommodityRisk, 
      sortValue: totalCommodityRisk,
      percentage: getPercentage(totalCommodityRisk),
      color: 'bg-orange-500',
      icon: BarChart3,
      description: 'Materie prime',
      protectionSavings: 0,
      showProtectionSavings: false
    },
    { 
      label: 'Rischio Naked PUT', 
      value: includeNakedPut ? totalNakedPutRisk : 0, 
      sortValue: totalNakedPutRisk,
      percentage: getPercentage(includeNakedPut ? totalNakedPutRisk : 0),
      color: 'bg-red-500',
      icon: TrendingDown,
      description: 'Strike × Contratti × 100',
      protectionSavings: 0,
      showProtectionSavings: false
    },
    { 
      label: 'Rischio Leap Call', 
      value: includeLeapCall ? totalLeapCallRisk : 0, 
      sortValue: totalLeapCallRisk,
      percentage: getPercentage(includeLeapCall ? totalLeapCallRisk : 0),
      color: 'bg-amber-500',
      icon: DollarSign,
      description: 'Premio pagato (PMC × Contratti × 100)',
      protectionSavings: 0,
      showProtectionSavings: false
    },
    { 
      label: 'Rischio Strategie', 
      value: includeStrategies ? totalStrategyRisk : 0, 
      sortValue: totalStrategyRisk,
      percentage: getPercentage(includeStrategies ? totalStrategyRisk : 0),
      color: 'bg-purple-500',
      icon: BarChart3,
      description: 'Max Loss delle strategie',
      protectionSavings: 0,
      showProtectionSavings: false
    },
    { 
      label: 'Rischio CC e DR-CC sintetiche', 
      value: includeSynthCcDrcc ? totalSyntheticCcDrccRisk : 0, 
      sortValue: totalSyntheticCcDrccRisk,
      percentage: getPercentage(includeSynthCcDrcc ? totalSyntheticCcDrccRisk : 0),
      color: 'bg-fuchsia-500',
      icon: Layers,
      description: 'Sintetiche: long CALL + short CALL / short PUT ITM + short CALL [+ protezione]',
      protectionSavings: 0,
      showProtectionSavings: false
    },
    ...(gpStockHoldings.length > 0 ? [{
      label: 'Rischio GP Azioni',
      value: includeGP ? gpStockTotalValue : 0,
      sortValue: gpStockTotalValue,
      percentage: getPercentage(includeGP ? gpStockTotalValue : 0),
      color: 'bg-emerald-500',
      icon: Layers,
      description: 'Azioni gestione patrimoniale',
      protectionSavings: 0,
      showProtectionSavings: false,
    }] : []),
  ];

  const formatExpiry = (expiry: string) => {
    if (!expiry) return '-';
    const date = new Date(expiry);
    const month = date.toLocaleDateString('it-IT', { month: 'short' }).toUpperCase();
    const year = date.getFullYear().toString().slice(-2);
    return `${month}/${year}`;
  };

  const hasData = stockDetails.length > 0 || nakedPutDetails.length > 0 || 
                  leapCallDetails.length > 0 || strategyDetails.length > 0;

  return (
    <div className="space-y-6">
      {/* Total Exposure Card with Donut Chart */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Total Card */}
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex justify-between gap-4">
              {/* Left column: title, value, description */}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-1.5 rounded bg-primary/20">
                    <ShieldAlert className="w-4 h-4 text-primary" />
                  </div>
                  <span className="text-sm font-medium text-primary">Esposizione in Equity e Commodities</span>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="w-4 h-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-sm">
                        <p className="mb-2">Usa i toggle per includere/escludere componenti dal totale:</p>
                        <ul className="list-disc ml-4 space-y-1">
                          <li><b>Protezioni</b>: calcola azioni al netto delle Long PUT</li>
                          <li><b>Naked Put</b>: include rischio Naked PUT (Strike × Ctr × 100)</li>
                          <li><b>Strategie</b>: include Max Loss delle strategie</li>
                          <li><b>Leap Call</b>: include valore di mercato Leap Call</li>
                        </ul>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="text-3xl font-bold text-primary">{formatEUR(dynamicGrandTotal)}</div>
                <div className="text-xs text-muted-foreground mt-1">Somma di tutte le categorie di rischio</div>
                {portfolioTotalValue && portfolioTotalValue > 0 && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    ({((dynamicGrandTotal / portfolioTotalValue) * 100).toFixed(1)}% del valore asset)
                  </div>
                )}
              </div>
              
              {/* Right column: toggles stacked vertically */}
              <div className="flex flex-col gap-2 border-l border-border/50 pl-4">
                <div className="flex items-center gap-2">
                  <Switch 
                    id="protections-toggle"
                    checked={includeProtections}
                    onCheckedChange={setIncludeProtections}
                  />
                  <Label htmlFor="protections-toggle" className="text-sm cursor-pointer">
                    Protezioni
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch 
                    id="naked-put-toggle"
                    checked={includeNakedPut}
                    onCheckedChange={setIncludeNakedPut}
                  />
                  <Label htmlFor="naked-put-toggle" className="text-sm cursor-pointer">
                    Naked Put
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch 
                    id="strategies-toggle"
                    checked={includeStrategies}
                    onCheckedChange={setIncludeStrategies}
                  />
                  <Label htmlFor="strategies-toggle" className="text-sm cursor-pointer">
                    Strategie
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch 
                    id="leap-call-toggle"
                    checked={includeLeapCall}
                    onCheckedChange={setIncludeLeapCall}
                  />
                  <Label htmlFor="leap-call-toggle" className="text-sm cursor-pointer">
                    Leap Call
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch 
                    id="synth-cc-drcc-toggle"
                    checked={includeSynthCcDrcc}
                    onCheckedChange={setIncludeSynthCcDrcc}
                  />
                  <Label htmlFor="synth-cc-drcc-toggle" className="text-sm cursor-pointer">
                    CC/DR-CC sint.
                  </Label>
                </div>
                {gpStockHoldings.length > 0 && onIncludeGPChange && (
                  <div className="flex items-center gap-2">
                    <Switch 
                      id="gp-equity-toggle"
                      checked={includeGP}
                      onCheckedChange={onIncludeGPChange}
                    />
                    <Label htmlFor="gp-equity-toggle" className="text-sm cursor-pointer">
                      GP
                    </Label>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Donut Chart */}
        <Card className="border-border bg-card">
          <CardContent className="pt-4 pb-2">
            <div className="flex items-center gap-4">
              <div className="w-32 h-32 flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[...riskCategories].filter(c => c.value > 0).sort((a, b) => b.sortValue - a.sortValue)}
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={50}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {[...riskCategories].filter(c => c.value > 0).sort((a, b) => b.sortValue - a.sortValue).map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={entry.color.replace('bg-', '').replace('-500', '')}
                          className={entry.color}
                          style={{ 
                            fill: entry.color === 'bg-cyan-500' ? '#06b6d4' :
                                  entry.color === 'bg-blue-500' ? '#3b82f6' :
                                  entry.color === 'bg-orange-500' ? '#f97316' :
                                  entry.color === 'bg-red-500' ? '#ef4444' :
                                  entry.color === 'bg-amber-500' ? '#f59e0b' :
                                  entry.color === 'bg-emerald-500' ? '#10b981' :
                                  entry.color === 'bg-fuchsia-500' ? '#d946ef' :
                                  '#a855f7'
                          }}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1.5">
                {[...riskCategories].filter(c => c.value > 0).sort((a, b) => b.sortValue - a.sortValue).map((cat, index) => (
                  <div key={index} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ 
                          backgroundColor: cat.color === 'bg-cyan-500' ? '#06b6d4' :
                                           cat.color === 'bg-blue-500' ? '#3b82f6' :
                                           cat.color === 'bg-orange-500' ? '#f97316' :
                                           cat.color === 'bg-red-500' ? '#ef4444' :
                                           cat.color === 'bg-amber-500' ? '#f59e0b' :
                                           cat.color === 'bg-emerald-500' ? '#10b981' :
                                           cat.color === 'bg-fuchsia-500' ? '#d946ef' :
                                           '#a855f7'
                        }}
                      />
                      <span className="text-muted-foreground">{cat.label}</span>
                    </div>
                    <span className="font-medium">{cat.percentage.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Horizontal Bar Chart */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Distribuzione del Rischio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {[...riskCategories].sort((a, b) => b.sortValue - a.sortValue).map((cat, index) => (
            <div key={index} className="space-y-1.5">
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <div className={`p-1 rounded ${cat.color} bg-opacity-20`}>
                      <cat.icon className={`w-3.5 h-3.5 ${cat.color.replace('bg-', 'text-')}`} />
                    </div>
                    <span className="font-medium text-sm">{cat.label}</span>
                  </div>
                  <span className="text-xs text-muted-foreground ml-6">{cat.description}</span>
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <span className="font-semibold">{formatEUR(cat.value)}</span>
                    <span className="text-muted-foreground text-sm ml-2">({cat.percentage.toFixed(1)}%)</span>
                    {cat.label === 'Rischio Naked PUT' && nakedPutVsBondPct !== null && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-xs text-red-400 ml-1 cursor-help">
                              [{nakedPutVsBondPct.toFixed(0)}% vs Bond]
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-sm">
                            <p>Percentuale del rischio Naked PUT rispetto al valore totale delle obbligazioni in portafoglio.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                  {cat.showProtectionSavings && (
                    <div className="text-xs text-green-500">
                      Protezioni: -{formatEUR(cat.protectionSavings)}
                    </div>
                  )}
                </div>
              </div>
              <div className="h-5 bg-muted rounded-full overflow-hidden">
                <div 
                  className={`h-full ${cat.color} transition-all duration-500 flex items-center justify-end pr-2`}
                  style={{ width: `${Math.max(cat.percentage, 2)}%` }}
                >
                  {cat.percentage > 10 && (
                    <span className="text-xs font-medium text-white">
                      {cat.percentage.toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Detailed Sections */}
      <Accordion type="multiple" className="space-y-4">
        {/* ETF Details */}
        {etfDetails.length > 0 && (
          <AccordionItem value="etfs" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 hover:no-underline">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded bg-cyan-500/20">
                  <TrendingUp className="w-4 h-4 text-cyan-500" />
                </div>
                <div className="text-left">
                  <div className="font-semibold">Dettaglio ETF Azionari</div>
                  <div className="text-sm text-muted-foreground">
                    {etfDetails.length} ETF • Rischio totale: {formatEUR(totalETFRisk)}
                  </div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-4">
              <div className="space-y-2">
                {sortedETFDetails.map((stock, index) => {
                  const protectedPct = stock.stockValue > 0 
                    ? (stock.protectedValue / stock.stockValue) * 100 
                    : 0;
                  const riskPct = 100 - protectedPct;
                  
                  return (
                    <div key={index} className="p-3 rounded-lg bg-muted/50 space-y-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-semibold flex items-center gap-2">
                            {stock.underlying}
                            {stock.hasProtection && (
                              <Badge variant="outline" className="text-green-600 border-green-600">
                                <Shield className="w-3 h-3 mr-1" />
                                Protetto
                              </Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {formatNumber(stock.stockQuantity)} quote @ {stock.currency} {formatNumber(stock.stockPrice, 2)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-cyan-500">
                            Rischio: {formatEUR(stock.riskEUR)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {stock.currency} {formatNumber(stock.riskOriginal, 0)} / {stock.exchangeRate.toFixed(4)}
                          </div>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Valore:</span>
                          <span className="ml-2 font-medium">{stock.currency} {formatNumber(stock.stockValue, 0)}</span>
                        </div>
                        {stock.hasProtection && (
                          <>
                            <div>
                              <span className="text-muted-foreground">PUT:</span>
                              <span className="ml-2 font-medium">{stock.currency} {formatNumber(stock.protectionStrike || 0)}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Ctr:</span>
                              <span className="ml-2 font-medium">{stock.protectionContracts}</span>
                            </div>
                          </>
                        )}
                      </div>
                      {(stock.ccCappedShares || stock.drccCappedShares) && (
                        <div className="text-xs text-muted-foreground">
                          {stock.ccCappedShares ? (
                            <span>Cap CC ITM: {formatNumber(stock.ccCappedShares)} az. @ strike {stock.currency} {formatNumber(stock.ccCapStrike || 0, 2)}</span>
                          ) : null}
                          {stock.ccCappedShares && stock.drccCappedShares ? ' • ' : ''}
                          {stock.drccCappedShares ? (
                            <span>Cap DR-CC ITM: {formatNumber(stock.drccCappedShares)} az. @ {stock.currency} {formatNumber(stock.drccCapPerShare || 0, 2)}/az.</span>
                          ) : null}
                        </div>
                      )}
                      
                      {/* Protection Bar */}
                      <div className="h-3 rounded-full overflow-hidden flex">
                          {protectedPct > 0 && (
                            <div 
                              className="bg-green-500 h-full flex items-center justify-center"
                              style={{ width: `${protectedPct}%` }}
                            >
                              {protectedPct > 15 && (
                                <span className="text-xs text-white font-medium">
                                  Protetto {protectedPct.toFixed(0)}%
                                </span>
                              )}
                            </div>
                          )}
                          <div 
                            className="bg-cyan-500 h-full flex items-center justify-center"
                            style={{ width: `${riskPct}%` }}
                          >
                            {riskPct > 15 && (
                              <span className="text-xs text-white font-medium">
                                Rischio {riskPct.toFixed(0)}%
                              </span>
                            )}
                          </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Pure Stock Details */}
        {pureStockDetails.length > 0 && (
          <AccordionItem value="stocks" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 hover:no-underline">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded bg-blue-500/20">
                  <TrendingUp className="w-4 h-4 text-blue-500" />
                </div>
                <div className="text-left">
                  <div className="font-semibold">Dettaglio Stocks</div>
                  <div className="text-sm text-muted-foreground">
                    {pureStockDetails.length} azioni • Rischio totale: {formatEUR(totalPureStockRisk)}
                  </div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-4">
              <div className="space-y-2">
                {sortedPureStockDetails.map((stock, index) => {
                  const protectedPct = stock.stockValue > 0 
                    ? (stock.protectedValue / stock.stockValue) * 100 
                    : 0;
                  const riskPct = 100 - protectedPct;
                  
                  return (
                    <div key={index} className="p-3 rounded-lg bg-muted/50 space-y-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-semibold flex items-center gap-2">
                            {stock.underlying}
                            {stock.isSynthetic && (
                              <Badge variant="outline" className="text-amber-500 border-amber-500">
                                Sintetica {stock.syntheticType?.startsWith('drcc') ? 'DR-CC' : 'CC'}
                              </Badge>
                            )}
                            {stock.hasProtection && (
                              <Badge variant="outline" className="text-green-600 border-green-600">
                                <Shield className="w-3 h-3 mr-1" />
                                Protetto
                              </Badge>
                            )}
                          </div>
                          {!stock.isSynthetic && (
                            <div className="text-sm text-muted-foreground">
                              {formatNumber(stock.stockQuantity)} azioni @ {stock.currency} {formatNumber(stock.stockPrice, 2)}
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-blue-500">
                            Rischio: {formatEUR(stock.riskEUR)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {stock.currency} {formatNumber(stock.riskOriginal, 0)} / {stock.exchangeRate.toFixed(4)}
                          </div>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Valore:</span>
                          <span className="ml-2 font-medium">{stock.currency} {formatNumber(stock.stockValue, 0)}</span>
                        </div>
                        {stock.hasProtection && (
                          <>
                            <div>
                              <span className="text-muted-foreground">PUT:</span>
                              <span className="ml-2 font-medium">{stock.currency} {formatNumber(stock.protectionStrike || 0)}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Ctr:</span>
                              <span className="ml-2 font-medium">{stock.protectionContracts}</span>
                            </div>
                          </>
                        )}
                      </div>
                      {(stock.ccCappedShares || stock.drccCappedShares) && (
                        <div className="text-xs text-muted-foreground">
                          {stock.ccCappedShares ? (
                            <span>Cap CC ITM: {formatNumber(stock.ccCappedShares)} az. @ strike {stock.currency} {formatNumber(stock.ccCapStrike || 0, 2)}</span>
                          ) : null}
                          {stock.ccCappedShares && stock.drccCappedShares ? ' • ' : ''}
                          {stock.drccCappedShares ? (
                            <span>Cap DR-CC ITM: {formatNumber(stock.drccCappedShares)} az. @ {stock.currency} {formatNumber(stock.drccCapPerShare || 0, 2)}/az.</span>
                          ) : null}
                        </div>
                      )}
                      
                      {/* Protection Bar */}
                      <div className="h-3 rounded-full overflow-hidden flex">
                          {protectedPct > 0 && (
                            <div 
                              className="bg-green-500 h-full flex items-center justify-center"
                              style={{ width: `${protectedPct}%` }}
                            >
                              {protectedPct > 15 && (
                                <span className="text-xs text-white font-medium">
                                  Protetto {protectedPct.toFixed(0)}%
                                </span>
                              )}
                            </div>
                          )}
                          <div 
                            className="bg-blue-500 h-full flex items-center justify-center"
                            style={{ width: `${riskPct}%` }}
                          >
                            {riskPct > 15 && (
                              <span className="text-xs text-white font-medium">
                                Rischio {riskPct.toFixed(0)}%
                              </span>
                            )}
                          </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Synthetic CC and DR-CC Details */}
        {syntheticCcDrccDetails.length > 0 && (
          <AccordionItem value="synth-cc-drcc" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 hover:no-underline">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded bg-fuchsia-500/20">
                  <Layers className="w-4 h-4 text-fuchsia-500" />
                </div>
                <div className="text-left">
                  <div className="font-semibold">Dettaglio CC e DR-CC sintetiche</div>
                  <div className="text-sm text-muted-foreground">
                    {syntheticCcDrccDetails.length} posizioni • Rischio totale: {formatEUR(totalSyntheticCcDrccRisk)}
                  </div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-4">
              <div className="space-y-2">
                {sortedSyntheticCcDrccDetails.map((s, index) => {
                  const isDrcc = s.syntheticType?.startsWith('drcc');
                  const variant = s.syntheticType?.endsWith('call') ? 'CALL' : 'PUT';
                  return (
                    <div key={index} className="p-3 rounded-lg bg-muted/50 space-y-2">
                      <div className="flex justify-between items-start gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold flex items-center gap-2 flex-wrap">
                            {s.underlying}
                            <Badge variant="outline" className={isDrcc ? 'text-fuchsia-500 border-fuchsia-500' : 'text-amber-500 border-amber-500'}>
                              {isDrcc ? 'DR-CC' : 'CC'} sintetica ({variant})
                            </Badge>
                          </div>
                          {s.composition && (
                            <div className="text-xs text-muted-foreground mt-1 break-words">
                              {s.composition}
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-semibold text-fuchsia-500">
                            Rischio: {formatEUR(s.riskEUR)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {s.currency} {formatNumber(s.riskOriginal, 0)} / {s.exchangeRate.toFixed(4)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}



        {/* Commodity Details */}
        {commodityDetails.length > 0 && (
          <AccordionItem value="commodities" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 hover:no-underline">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded bg-orange-500/20">
                  <BarChart3 className="w-4 h-4 text-orange-500" />
                </div>
                <div className="text-left">
                  <div className="font-semibold">Dettaglio Commodities</div>
                  <div className="text-sm text-muted-foreground">
                    {commodityDetails.length} posizioni • Rischio totale: {formatEUR(totalCommodityRisk)}
                  </div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-4">
              <div className="space-y-3">
                {sortedCommodityDetails.map((commodity, index) => (
                  <div key={index} className="p-4 rounded-lg bg-muted/50 flex justify-between items-center">
                    <div>
                      <div className="font-semibold">{commodity.underlying}</div>
                      <div className="text-sm text-muted-foreground">
                        {formatNumber(commodity.quantity)} unità @ {commodity.currency} {formatNumber(commodity.price, 2)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-orange-500">
                        {formatEUR(commodity.riskEUR)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {commodity.currency} {formatNumber(commodity.riskOriginal, 0)} / {commodity.exchangeRate.toFixed(4)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Naked PUT Details */}
        {nakedPutDetails.length > 0 && (
          <AccordionItem value="naked-puts" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 hover:no-underline">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded bg-red-500/20">
                  <TrendingDown className="w-4 h-4 text-red-500" />
                </div>
                <div className="text-left">
                  <div className="font-semibold">Dettaglio Naked PUT</div>
                  <div className="text-sm text-muted-foreground">
                    {nakedPutDetails.length} posizioni • Rischio totale: {formatEUR(totalNakedPutRisk)}
                  </div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-4">
              <div className="space-y-3">
                {sortedNakedPutDetails.map((np, index) => (
                  <div key={index} className="p-4 rounded-lg bg-muted/50 flex justify-between items-center">
                    <div>
                      <div className="font-semibold">{np.underlying}</div>
                      <div className="text-sm text-muted-foreground">
                        Strike {np.currency} {formatNumber(np.strike)} • {np.contracts} contratti • {formatExpiry(np.expiry)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-red-500">
                        {formatEUR(np.riskEUR)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {np.currency} {formatNumber(np.riskOriginal, 0)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Leap Call Details */}
        {leapCallDetails.length > 0 && (
          <AccordionItem value="leap-calls" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 hover:no-underline">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded bg-amber-500/20">
                  <DollarSign className="w-4 h-4 text-amber-500" />
                </div>
                <div className="text-left">
                  <div className="font-semibold">Dettaglio Leap Call</div>
                  <div className="text-sm text-muted-foreground">
                    {leapCallDetails.length} posizioni • Rischio totale: {formatEUR(totalLeapCallRisk)}
                  </div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-4">
              <div className="space-y-3">
                {sortedLeapCallDetails.map((lc, index) => (
                  <div key={index} className="p-4 rounded-lg bg-muted/50 flex justify-between items-center">
                    <div>
                      <div className="font-semibold">{lc.underlying}</div>
                      <div className="text-sm text-muted-foreground">
                        Strike {lc.currency} {formatNumber(lc.strike)} • {lc.contracts} contratti • PMC {formatNumber(lc.avgCost, 2)} • {formatExpiry(lc.expiry)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-amber-500">
                        {formatEUR(lc.riskEUR)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Mkt: {lc.currency} {formatNumber(lc.marketValue, 0)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Strategy Details */}
        {strategyDetails.length > 0 && (
          <AccordionItem value="strategies" className="border rounded-lg bg-card">
            <AccordionTrigger className="px-6 hover:no-underline">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded bg-purple-500/20">
                  <BarChart3 className="w-4 h-4 text-purple-500" />
                </div>
                <div className="text-left">
                  <div className="font-semibold">Dettaglio Strategie</div>
                  <div className="text-sm text-muted-foreground">
                    {strategyDetails.length} strategie • Rischio totale: {formatEUR(totalStrategyRisk)}
                  </div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-4">
              <div className="space-y-1">
                {sortedStrategyDetails.map((strat, index) => (
                  <div key={index} className="flex items-center justify-between p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <BarChart3 className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{strat.underlying}</span>
                          <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 bg-purple-500/10 text-purple-500 border-purple-500/30">
                            {strat.strategyName}
                          </Badge>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p className="font-medium">Calcolo Max Loss:</p>
                                <p className="text-sm">{strat.calculation}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          {strat.hasUnlimitedRisk && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  <p className="font-medium text-amber-500">Rischio Illimitato</p>
                                  <p className="text-sm">
                                    Il Max Loss mostrato considera solo il lato PUT (rischio definito). 
                                    Il lato CALL ha rischio teoricamente illimitato.
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          ML: {strat.currency} {formatNumber(strat.maxLoss, 0)}
                        </span>
                      </div>
                    </div>
                    <span className="font-medium text-sm text-purple-500 flex-shrink-0">
                      {formatEUR(strat.maxLossEUR)}
                    </span>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
      
      {/* Top 10 Holdings Consolidate */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="w-5 h-5 text-primary" />
              Holdings Consolidate ({consolidatedHoldings.length})
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-4 h-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-sm">
                    <p>Aggregazione dell'esposizione per sottostante: Stock diretti, Naked PUT (strike × contratti × 100), Leap Call (prezzo di mercato × contratti × 100) e Max Loss delle strategie complesse.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Switch 
                id="include-protections"
                checked={includeProtections}
                onCheckedChange={setIncludeProtections}
              />
              <Label htmlFor="include-protections" className="text-sm text-muted-foreground cursor-pointer">
                Includi Protezioni
              </Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-4 h-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-sm">
                    <p>Quando attivo, il rischio stock è calcolato al netto delle protezioni PUT. Quando disattivo, mostra il valore pieno.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingETFData ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              <span>Caricamento dati ETF...</span>
            </div>
          ) : consolidatedHoldings.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              Nessun holding consolidato disponibile
            </div>
          ) : (
            <div className="space-y-2">
              {sortedConsolidatedHoldings.map((holding, index) => {
                const hasStock = (includeProtections ? holding.stockRiskWithProtection : holding.stockRisk) > 0;
                const hasNakedPut = holding.nakedPutRisk > 0;
                const hasLeapCall = holding.leapCallRisk > 0;
                const hasStrategy = holding.strategyRisk > 0;
                const hasGP = holding.gpRisk > 0;
                const stockValue = includeProtections ? holding.stockRiskWithProtection : holding.stockRisk;
                
                return (
                  <div
                    key={holding.name}
                    className="p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => {
                      setSelectedHolding(holding);
                      setBreakdownOpen(true);
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="text-sm font-bold text-muted-foreground w-6 text-right flex-shrink-0">
                          {index + 1}.
                        </span>
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="font-medium truncate">
                            {holding.ticker ? (
                              <>
                                <span className="text-primary font-bold">{holding.ticker}</span>
                                <span className="text-muted-foreground"> — </span>
                                <span>{holding.name}</span>
                              </>
                            ) : (() => {
                              // Fallback: derive a presumed ticker from the first significant token
                              const cleaned = (holding.name || '')
                                .replace(/^AZ\./i, '')
                                .replace(/[-_,.]/g, ' ')
                                .trim();
                              const firstToken = cleaned.split(/\s+/)[0]?.toUpperCase() || '';
                              const presumed = /^[A-Z][A-Z0-9]{1,5}$/.test(firstToken) ? firstToken : null;
                              return presumed ? (
                                <>
                                  <span className="text-muted-foreground font-bold">{presumed}</span>
                                  <span className="text-muted-foreground"> — </span>
                                  <span>{holding.name}</span>
                                </>
                              ) : (
                                holding.name
                              );
                            })()}
                          </span>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {hasStock && (
                              <Badge 
                                variant="outline" 
                                className={`text-xs px-1.5 py-0 h-5 ${
                                  includeProtections && holding.stockRiskWithProtection < holding.stockRisk
                                    ? 'bg-green-500/10 text-green-500 border-green-500/30'
                                    : 'bg-blue-500/10 text-blue-500 border-blue-500/30'
                                }`}
                              >
                                Stock: {formatEUR(stockValue)}
                                {includeProtections && holding.stockRiskWithProtection < holding.stockRisk && (
                                  <Shield className="w-3 h-3 ml-1" />
                                )}
                              </Badge>
                            )}
                            {hasNakedPut && (
                              <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 bg-red-500/10 text-red-500 border-red-500/30">
                                PUT: {formatEUR(holding.nakedPutRisk)}
                              </Badge>
                            )}
                            {hasLeapCall && (
                              <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 bg-amber-500/10 text-amber-500 border-amber-500/30">
                                LEAP: {formatEUR(holding.leapCallRisk)}
                              </Badge>
                            )}
                            {hasStrategy && (
                              <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 bg-purple-500/10 text-purple-500 border-purple-500/30">
                                Strategie: {formatEUR(holding.strategyRisk)}
                              </Badge>
                            )}
                            {hasGP && (
                              <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
                                GP: {formatEUR(holding.gpRisk)}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 flex items-center gap-2">
                        <div className="font-semibold text-primary">
                          {formatEUR(holding.totalExposure)}
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Holding Breakdown Dialog */}
      <HoldingBreakdownDialog
        holding={selectedHolding}
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        includeProtections={includeProtections}
      />

      {/* Empty State */}
      {!hasData && (
        <Card className="border-border bg-card">
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <ShieldAlert className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="font-medium">Nessun rischio rilevato</p>
              <p className="text-sm">Carica un portfolio per visualizzare l'analisi del rischio</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
