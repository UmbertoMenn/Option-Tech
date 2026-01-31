import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  ArrowLeft, 
  ShieldAlert, 
  TrendingUp, 
  LogOut,
  TrendingDown,
  DollarSign,
  BarChart3,
  ChevronDown,
  Shield,
  AlertTriangle
} from 'lucide-react';
import { useRiskAnalysis } from '@/hooks/useRiskAnalysis';
import { formatEUR, formatNumber } from '@/lib/formatters';
import { 
  Accordion, 
  AccordionContent, 
  AccordionItem, 
  AccordionTrigger 
} from '@/components/ui/accordion';
import { Progress } from '@/components/ui/progress';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';

export function RiskAnalyzer() {
  const { signOut } = useAuth();
  const { 
    totalStockRisk,
    totalCommodityRisk,
    totalNakedPutRisk,
    totalLeapCallRisk,
    totalStrategyRisk,
    grandTotal,
    stockDetails,
    commodityDetails,
    nakedPutDetails,
    leapCallDetails,
    strategyDetails,
    isLoading
  } = useRiskAnalysis();

  // Calculate percentages for the bar chart
  const getPercentage = (value: number) => grandTotal > 0 ? (value / grandTotal) * 100 : 0;

  const riskCategories = [
    { 
      label: 'Rischio Stocks', 
      value: totalStockRisk, 
      percentage: getPercentage(totalStockRisk),
      color: 'bg-blue-500',
      icon: TrendingUp,
      description: 'Azioni e ETF (al netto di protezioni PUT)'
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

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background-secondary/50 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <ShieldAlert className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-bold">Risk Analyzer</h1>
                <p className="text-xs text-muted-foreground">
                  Esposizione reale in equity (EUR)
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Dashboard
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/derivatives">
                  <TrendingUp className="w-4 h-4 mr-2" />
                  Strategie Derivati
                </Link>
              </Button>
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut className="w-4 h-4 mr-2" />
                Esci
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        {isLoading ? (
          <Card className="border-border bg-card">
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <ShieldAlert className="w-12 h-12 mx-auto mb-4 opacity-50 animate-pulse" />
                <p>Caricamento analisi del rischio...</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              {riskCategories.map((cat, index) => (
                <Card key={index} className="border-border bg-card">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`p-1.5 rounded ${cat.color} bg-opacity-20`}>
                        <cat.icon className={`w-4 h-4 ${cat.color.replace('bg-', 'text-')}`} />
                      </div>
                      <span className="text-sm font-medium text-muted-foreground">{cat.label}</span>
                    </div>
                    <div className="text-2xl font-bold">{formatEUR(cat.value)}</div>
                    <div className="text-xs text-muted-foreground mt-1">{cat.description}</div>
                    <div className="mt-2">
                      <div className={`h-1.5 rounded-full ${cat.color} bg-opacity-30`}>
                        <div 
                          className={`h-1.5 rounded-full ${cat.color}`} 
                          style={{ width: `${cat.percentage}%` }}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {cat.percentage.toFixed(1)}% del totale
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              
              {/* Total Card */}
              <Card className="border-primary/50 bg-primary/5">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="p-1.5 rounded bg-primary/20">
                      <ShieldAlert className="w-4 h-4 text-primary" />
                    </div>
                    <span className="text-sm font-medium text-primary">Esposizione Totale</span>
                  </div>
                  <div className="text-2xl font-bold text-primary">{formatEUR(grandTotal)}</div>
                  <div className="text-xs text-muted-foreground mt-1">Somma di tutte le categorie</div>
                </CardContent>
              </Card>
            </div>

            {/* Horizontal Bar Chart */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Distribuzione del Rischio</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {riskCategories.map((cat, index) => (
                  <div key={index} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{cat.label}</span>
                      <span className="text-muted-foreground">
                        {formatEUR(cat.value)} ({cat.percentage.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-6 bg-muted rounded-full overflow-hidden">
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
              {/* Stock Details */}
              {stockDetails.length > 0 && (
                <AccordionItem value="stocks" className="border rounded-lg bg-card">
                  <AccordionTrigger className="px-6 hover:no-underline">
                    <div className="flex items-center gap-3">
                      <div className="p-1.5 rounded bg-blue-500/20">
                        <TrendingUp className="w-4 h-4 text-blue-500" />
                      </div>
                      <div className="text-left">
                        <div className="font-semibold">Dettaglio Stocks</div>
                        <div className="text-sm text-muted-foreground">
                          {stockDetails.length} titoli • Rischio totale: {formatEUR(totalStockRisk)}
                        </div>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-6 pb-4">
                    <div className="space-y-4">
                      {stockDetails.map((stock, index) => {
                        const protectedPct = stock.stockValue > 0 
                          ? (stock.protectedValue / stock.stockValue) * 100 
                          : 0;
                        const riskPct = 100 - protectedPct;
                        
                        return (
                          <div key={index} className="p-4 rounded-lg bg-muted/50 space-y-3">
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
                                <div className="font-semibold text-red-500">
                                  Rischio: {formatEUR(stock.riskEUR)}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {stock.currency} {formatNumber(stock.riskOriginal, 0)} / {stock.exchangeRate.toFixed(4)}
                                </div>
                              </div>
                            </div>
                            
                            <div className="grid grid-cols-3 gap-4 text-sm">
                              <div>
                                <span className="text-muted-foreground">Valore Azioni:</span>
                                <span className="ml-2 font-medium">{stock.currency} {formatNumber(stock.stockValue, 0)}</span>
                              </div>
                              {stock.hasProtection && (
                                <>
                                  <div>
                                    <span className="text-muted-foreground">PUT Strike:</span>
                                    <span className="ml-2 font-medium">{stock.currency} {formatNumber(stock.protectionStrike || 0)}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Contratti:</span>
                                    <span className="ml-2 font-medium">{stock.protectionContracts}</span>
                                  </div>
                                </>
                              )}
                            </div>
                            
                            {/* Protection Bar */}
                            <div className="space-y-1">
                              <div className="h-4 rounded-full overflow-hidden flex">
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
                                  className="bg-red-500 h-full flex items-center justify-center"
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
            {stockDetails.length === 0 && nakedPutDetails.length === 0 && 
             leapCallDetails.length === 0 && strategyDetails.length === 0 && (
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
          </>
        )}
      </main>
    </div>
  );
}
