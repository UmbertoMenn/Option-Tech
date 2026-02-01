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
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { 
  ShieldAlert, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  BarChart3, 
  Shield, 
  AlertTriangle 
} from 'lucide-react';
import { RiskAnalysis } from '@/lib/riskCalculator';
import { formatEUR, formatNumber } from '@/lib/formatters';

interface EquityExposureViewProps {
  analysis: RiskAnalysis;
}

export function EquityExposureView({ analysis }: EquityExposureViewProps) {
  const {
    totalStockRisk,
    totalETFRisk,
    totalPureStockRisk,
    totalCommodityRisk,
    totalNakedPutRisk,
    totalLeapCallRisk,
    totalStrategyRisk,
    grandTotal,
    stockDetails,
    commodityDetails,
    nakedPutDetails,
    leapCallDetails,
    strategyDetails
  } = analysis;

  const getPercentage = (value: number) => grandTotal > 0 ? (value / grandTotal) * 100 : 0;

  // Separate ETF and pure stock details
  const etfDetails = stockDetails.filter(s => s.isETF);
  const pureStockDetails = stockDetails.filter(s => !s.isETF);

  const riskCategories = [
    { 
      label: 'Rischio ETF Azionari', 
      value: totalETFRisk, 
      percentage: getPercentage(totalETFRisk),
      color: 'bg-cyan-500',
      icon: TrendingUp,
      description: 'ETF azionari'
    },
    { 
      label: 'Rischio Stocks', 
      value: totalPureStockRisk, 
      percentage: getPercentage(totalPureStockRisk),
      color: 'bg-blue-500',
      icon: TrendingUp,
      description: 'Azioni individuali (al netto di protezioni PUT)'
    },
    { 
      label: 'Rischio Commodities', 
      value: totalCommodityRisk, 
      percentage: getPercentage(totalCommodityRisk),
      color: 'bg-orange-500',
      icon: BarChart3,
      description: 'Materie prime'
    },
    { 
      label: 'Rischio Naked PUT', 
      value: totalNakedPutRisk, 
      percentage: getPercentage(totalNakedPutRisk),
      color: 'bg-red-500',
      icon: TrendingDown,
      description: 'Strike × Contratti × 100'
    },
    { 
      label: 'Rischio Leap Call', 
      value: totalLeapCallRisk, 
      percentage: getPercentage(totalLeapCallRisk),
      color: 'bg-amber-500',
      icon: DollarSign,
      description: 'Premio pagato (PMC × Contratti × 100)'
    },
    { 
      label: 'Rischio Strategie', 
      value: totalStrategyRisk, 
      percentage: getPercentage(totalStrategyRisk),
      color: 'bg-purple-500',
      icon: BarChart3,
      description: 'Max Loss delle strategie'
    },
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
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 rounded bg-primary/20">
                <ShieldAlert className="w-4 h-4 text-primary" />
              </div>
              <span className="text-sm font-medium text-primary">Esposizione Totale in Equity e Commodities</span>
            </div>
            <div className="text-3xl font-bold text-primary">{formatEUR(grandTotal)}</div>
            <div className="text-xs text-muted-foreground mt-1">Somma di tutte le categorie di rischio</div>
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
                      data={riskCategories.filter(c => c.value > 0)}
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={50}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {riskCategories.filter(c => c.value > 0).map((entry, index) => (
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
                                  '#a855f7'
                          }}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1.5">
                {riskCategories.filter(c => c.value > 0).map((cat, index) => (
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
          {riskCategories.map((cat, index) => (
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
                  <span className="font-semibold">{formatEUR(cat.value)}</span>
                  <span className="text-muted-foreground text-sm ml-2">({cat.percentage.toFixed(1)}%)</span>
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
                {etfDetails.map((stock, index) => {
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
                {pureStockDetails.map((stock, index) => {
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
                            {formatNumber(stock.stockQuantity)} azioni @ {stock.currency} {formatNumber(stock.stockPrice, 2)}
                          </div>
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
                {commodityDetails.map((commodity, index) => (
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
                {nakedPutDetails.map((np, index) => (
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
                {leapCallDetails.map((lc, index) => (
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
                        Premio: {lc.currency} {formatNumber(lc.premiumPaid, 0)}
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
              <div className="space-y-3">
                {strategyDetails.map((strat, index) => (
                  <div key={index} className="p-4 rounded-lg bg-muted/50 flex justify-between items-center">
                    <div>
                      <div className="font-semibold flex items-center gap-2">
                        {strat.strategyName}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <AlertTriangle className="w-4 h-4 text-muted-foreground" />
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
                                <AlertTriangle className="w-4 h-4 text-amber-500" />
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
                      <div className="text-sm text-muted-foreground">
                        {strat.underlying}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-purple-500">
                        {formatEUR(strat.maxLossEUR)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Max Loss: {strat.currency} {formatNumber(strat.maxLoss, 0)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>

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
