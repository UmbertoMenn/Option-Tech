import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileSpreadsheet, Upload, Calculator, AlertCircle, Trash2, BarChart3, Save, RefreshCw, ExternalLink, History } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { 
  parseOrderFile, 
  filterAndCalculateCallPremiums,
  filterAndCalculateIronCondorPremiums,
  filterAndCalculatePutPremiums,
  calculatePremiumMetrics,
  findFirstOperationDate,
  findLastOperationDate,
  mergeOrders,
  
  PremiumMetrics,
  ParsedOrder,
  OrderParseResult
} from '@/lib/orderFileParser';
import { formatCurrency, formatPercentage, formatNumber } from '@/lib/formatters';
import { buildOptionStratUrlFromOrders } from '@/lib/optionStratUrl';
import { useCoveredCallPremiums, CoveredCallPremium } from '@/hooks/useCoveredCallPremiums';
import { usePortfolio } from '@/hooks/usePortfolio';
import { toast } from 'sonner';

export type CalculatorStrategyType = 'covered_call' | 'iron_condor' | 'double_diagonal' | 'other_strategy';

interface CallPremiumCalculatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  underlying: string;
  ticker?: string;
  optionSymbol: string;
  contractsInPortfolio: number;
  underlyingPrice: number;
  strategyType?: CalculatorStrategyType;
}

export function CallPremiumCalculatorDialog({
  open,
  onOpenChange,
  underlying,
  ticker,
  optionSymbol,
  contractsInPortfolio,
  underlyingPrice,
  strategyType = 'covered_call',
}: CallPremiumCalculatorDialogProps) {
  const isMultiLeg = strategyType === 'iron_condor' || strategyType === 'double_diagonal' || strategyType === 'other_strategy';
  const isIronCondor = strategyType === 'iron_condor';
  const { portfolio } = usePortfolio();
  const { getPremiumByTickerAndSymbol, getPremiumsByTicker, upsertPremium, deletePremium, isUpserting, isLoading: isLoadingPremiums } = useCoveredCallPremiums(portfolio?.id);
  
  const isCoveredCall = strategyType === 'covered_call';
  
  const [transactionCost, setTransactionCost] = useState<number>(10);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<PremiumMetrics | null>(null);
  const [callOrders, setCallOrders] = useState<ParsedOrder[]>([]);
  const [putOrders, setPutOrders] = useState<ParsedOrder[]>([]);
  const [includePutPremiums, setIncludePutPremiums] = useState(false);
  const [parseResult, setParseResult] = useState<OrderParseResult | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastOperationDate, setLastOperationDate] = useState<string | null>(null);
  const [historicalPremiums, setHistoricalPremiums] = useState<CoveredCallPremium[]>([]);
  const [showHistoricalPicker, setShowHistoricalPicker] = useState(false);
  const [selectedHistoricalId, setSelectedHistoricalId] = useState<string>('');

  // Derived: combined orders based on toggle
  const filteredOrders = includePutPremiums ? [...callOrders, ...putOrders] : callOrders;

  // Helper to split saved orders into call/put
  const splitOrdersByType = (orders: ParsedOrder[]) => {
    const calls = orders.filter(o => o.optionType !== 'PUT');
    const puts = orders.filter(o => o.optionType === 'PUT');
    return { calls, puts };
  };

  // Load saved data when dialog opens
  useEffect(() => {
    if (open && ticker && !isLoadingPremiums) {
      const saved = getPremiumByTickerAndSymbol(ticker, optionSymbol);
      const allForTicker = getPremiumsByTicker(ticker);
      const historical = allForTicker.filter(p => p.option_symbol !== optionSymbol && p.orders_json.length > 0);
      setHistoricalPremiums(historical);
      setSelectedHistoricalId('');

      if (saved && saved.orders_json.length > 0) {
        setTransactionCost(saved.transaction_cost);
        const { calls, puts } = splitOrdersByType(saved.orders_json);
        setCallOrders(calls);
        setPutOrders(puts);
        setIncludePutPremiums(puts.length > 0);
        setLastOperationDate(saved.last_operation_date);
        recalculateMetrics(saved.orders_json, saved.transaction_cost);
        setHasUnsavedChanges(false);
        setShowHistoricalPicker(false);
      } else {
        setShowHistoricalPicker(historical.length > 0);
      }
    }
  }, [open, ticker, optionSymbol, isLoadingPremiums]);

  // Import historical premium data
  const handleImportHistorical = () => {
    if (!selectedHistoricalId) return;
    const selected = historicalPremiums.find(p => p.id === selectedHistoricalId);
    if (!selected) return;
    
    setTransactionCost(selected.transaction_cost);
    const { calls, puts } = splitOrdersByType(selected.orders_json);
    setCallOrders(calls);
    setPutOrders(puts);
    setIncludePutPremiums(puts.length > 0);
    setLastOperationDate(selected.last_operation_date);
    recalculateMetrics(selected.orders_json, selected.transaction_cost);
    setHasUnsavedChanges(true);
    setShowHistoricalPicker(false);
    toast.success(`Dati importati da ${selected.option_symbol}`);
  };

  // Recalculate metrics from current orders
  const recalculateMetrics = useCallback((orders: ParsedOrder[], txCost: number) => {
    if (orders.length === 0) {
      setMetrics(null);
      setLastOperationDate(null);
      return;
    }

    // Rebuild parse result from current orders
    let totalBuys = 0;
    let totalSells = 0;
    let netPremium = 0;

    orders.forEach(order => {
      if (order.operation === 'sell') {
        totalSells++;
        netPremium += order.orderValue;
      } else {
        totalBuys++;
        netPremium -= order.orderValue;
      }
    });

    // Find dates using shared utilities
    const firstOperationDate = findFirstOperationDate(orders.map(o => o.validityDate));
    const lastOpDate = findLastOperationDate(orders.map(o => o.validityDate));
    setLastOperationDate(lastOpDate);

    const newParseResult: OrderParseResult = {
      allOrders: orders,
      filteredOrders: orders,
      totalBuys,
      totalSells,
      netPremium,
      grossPremium: netPremium,
      firstOperationDate,
    };

    setParseResult(newParseResult);
    const newMetrics = calculatePremiumMetrics(newParseResult, txCost, contractsInPortfolio, underlyingPrice);
    setMetrics(newMetrics);
  }, [contractsInPortfolio, underlyingPrice]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    if (!ticker) {
      setError(isMultiLeg ? 'Ticker non disponibile per questa strategia' : 'Ticker non disponibile per questa Covered Call');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const orders = await parseOrderFile(file);
      const result = isMultiLeg
        ? filterAndCalculateIronCondorPremiums(orders, ticker)
        : filterAndCalculateCallPremiums(orders, ticker, underlyingPrice);
      
      // Merge CALL orders with existing
      const mergedCallOrders = mergeOrders(callOrders, result.filteredOrders);
      const newCallCount = mergedCallOrders.length - callOrders.length;
      setCallOrders(mergedCallOrders);
      
      // For covered_call: also parse PUT orders
      let mergedPutOrders = putOrders;
      let newPutCount = 0;
      if (isCoveredCall) {
        const putResult = filterAndCalculatePutPremiums(orders, ticker);
        mergedPutOrders = mergeOrders(putOrders, putResult.filteredOrders);
        newPutCount = mergedPutOrders.length - putOrders.length;
        setPutOrders(mergedPutOrders);
      }
      
      // Recalculate with appropriate orders
      const ordersForMetrics = includePutPremiums ? [...mergedCallOrders, ...mergedPutOrders] : mergedCallOrders;
      recalculateMetrics(ordersForMetrics, transactionCost);
      setHasUnsavedChanges(true);
      
      const totalNew = newCallCount + newPutCount;
      if (totalNew > 0) {
        const parts: string[] = [];
        if (newCallCount > 0) parts.push(`${newCallCount} CALL`);
        if (newPutCount > 0) parts.push(`${newPutCount} PUT`);
        toast.success(`Aggiunte ${parts.join(' + ')} operazioni`);
      } else {
        toast.info('Nessuna nuova operazione trovata');
      }
    } catch (err) {
      console.error('Error processing file:', err);
      setError(err instanceof Error ? err.message : 'Errore durante l\'elaborazione del file');
    } finally {
      setIsProcessing(false);
    }
  }, [ticker, transactionCost, callOrders, putOrders, underlyingPrice, recalculateMetrics, includePutPremiums, isCoveredCall, isMultiLeg]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
    maxFiles: 1,
  });

  // Handle transaction cost change
  const handleTransactionCostChange = (value: string) => {
    const cost = parseFloat(value) || 0;
    setTransactionCost(cost);
    
    if (filteredOrders.length > 0) {
      recalculateMetrics(filteredOrders, cost);
      setHasUnsavedChanges(true);
    }
  };

  // Handle PUT premiums toggle
  const handleTogglePutPremiums = (checked: boolean) => {
    setIncludePutPremiums(checked);
    const orders = checked ? [...callOrders, ...putOrders] : callOrders;
    recalculateMetrics(orders, transactionCost);
    setHasUnsavedChanges(true);
  };

  // Handle order removal
  const handleRemoveOrder = (index: number) => {
    const newOrders = filteredOrders.filter((_, i) => i !== index);
    // Split back into call/put
    const calls = newOrders.filter(o => o.optionType !== 'PUT');
    const puts = newOrders.filter(o => o.optionType === 'PUT');
    setCallOrders(calls);
    setPutOrders(puts);
    if (puts.length === 0) setIncludePutPremiums(false);
    recalculateMetrics(newOrders, transactionCost);
    setHasUnsavedChanges(true);
  };

  // Save to database
  const handleSave = async () => {
    if (!ticker || !metrics) return;
    
    try {
      await upsertPremium({
        ticker,
        option_symbol: optionSymbol,
        underlying,
        orders_json: filteredOrders,
        transaction_cost: transactionCost,
        net_per_share: isMultiLeg ? metrics.netPremium : metrics.netPerShare,
        first_operation_date: metrics.firstOperationDate,
        last_operation_date: lastOperationDate,
        contracts_count: contractsInPortfolio,
      });
      setHasUnsavedChanges(false);
      toast.success('Dati salvati');
    } catch (err) {
      console.error('Error saving premium data:', err);
      toast.error('Errore durante il salvataggio');
    }
  };

  // Reset all data
  const handleReset = async () => {
    if (ticker && confirm('Cancellare tutti i dati salvati per questo ticker?')) {
      try {
        await deletePremium({ ticker, optionSymbol });
        setMetrics(null);
        setCallOrders([]);
        setPutOrders([]);
        setIncludePutPremiums(false);
        setParseResult(null);
        setLastOperationDate(null);
        setHasUnsavedChanges(false);
        toast.success('Dati cancellati');
      } catch (err) {
        console.error('Error deleting premium data:', err);
        toast.error('Errore durante la cancellazione');
      }
    }
  };

  // Format date for display
  const formatDateDisplay = (isoDate: string | null): string => {
    if (!isoDate) return '-';
    const d = new Date(isoDate);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5" />
            {(strategyType === 'double_diagonal' || strategyType === 'iron_condor' || strategyType === 'other_strategy') ? 'Calcola Flussi di cassa' : isMultiLeg ? 'Calcola Gain Potenziale' : 'Calcola Premi CALL'}
          </DialogTitle>
          <DialogDescription>
            Sottostante: <span className="font-semibold">{underlying}</span>
            {ticker && <span className="text-muted-foreground"> ({ticker})</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Historical data picker banner */}
          {showHistoricalPicker && historicalPremiums.length > 0 && (
            <Alert className="border-blue-500/50 bg-blue-500/5">
              <History className="h-4 w-4 text-blue-500" />
              <AlertDescription className="space-y-3">
                <p className="text-sm font-medium">Dati storici disponibili per {ticker}</p>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Select value={selectedHistoricalId} onValueChange={setSelectedHistoricalId}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Seleziona una serie precedente..." />
                      </SelectTrigger>
                      <SelectContent>
                        {historicalPremiums.map(p => {
                          const updDate = new Date(p.updated_at);
                          const dateStr = `${String(updDate.getDate()).padStart(2, '0')}/${String(updDate.getMonth() + 1).padStart(2, '0')}/${updDate.getFullYear()}`;
                          return (
                            <SelectItem key={p.id} value={p.id} className="text-xs">
                              {p.option_symbol} — aggiornato il {dateStr}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handleImportHistorical}
                    disabled={!selectedHistoricalId}
                    className="h-8"
                  >
                    Importa
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Button to toggle historical picker when hidden but available */}
          {!showHistoricalPicker && historicalPremiums.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs gap-1.5"
              onClick={() => setShowHistoricalPicker(true)}
            >
              <History className="w-3.5 h-3.5" />
              Importa da storico ({historicalPremiums.length})
            </Button>
          )}

          {/* File Upload - Always visible to add operations */}
          <div
            {...getRootProps()}
            className={`
              border-2 border-dashed rounded-lg p-4 text-center cursor-pointer
              transition-colors
              ${isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}
              ${isProcessing ? 'opacity-50 pointer-events-none' : ''}
            `}
          >
            <input {...getInputProps()} />
            <div className="flex items-center justify-center gap-2">
              <Upload className="w-5 h-5 text-muted-foreground" />
              {isDragActive ? (
                <p className="text-sm text-primary">Rilascia il file qui...</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {filteredOrders.length > 0 ? 'Aggiungi operazioni da Excel' : 'Carica file Excel ordini'}
                </p>
              )}
            </div>
            {isProcessing && (
              <p className="text-sm text-primary mt-2">Elaborazione in corso...</p>
            )}
          </div>

          {/* PUT premiums toggle - only for covered_call when PUT orders are found */}
          {isCoveredCall && putOrders.length > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-border bg-muted/30">
              <Switch checked={includePutPremiums} onCheckedChange={handleTogglePutPremiums} />
              <span className="text-sm text-muted-foreground">
                Includi premi PUT
              </span>
              <Badge variant="secondary" className="text-xs ml-auto">
                {putOrders.length} PUT
              </Badge>
            </div>
          )}
          {/* Error Alert */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Main Metrics - Always visible when data loaded */}
          {metrics && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="pt-4 space-y-4">
                {/* Primary: Net per share */}
                 <div className="text-center pb-3 border-b border-border/50">
                   <p className="text-xs text-muted-foreground uppercase tracking-wide">
                     {(strategyType === 'double_diagonal' || strategyType === 'iron_condor' || strategyType === 'other_strategy') ? 'Flussi di cassa' : isMultiLeg ? 'Gain Potenziale' : 'Netto Unitario'}
                   </p>
                  <p className="text-3xl font-bold text-primary">
                     {isMultiLeg 
                      ? formatCurrency(metrics.netPremium, 'USD')
                      : formatCurrency(metrics.netPerShare, 'USD')
                     }
                  </p>
                   {!isMultiLeg && (
                    <p className="text-xs text-muted-foreground mt-1">
                      su {contractsInPortfolio} contratti ({contractsInPortfolio * 100} azioni)
                    </p>
                  )}
                </div>

                {/* Secondary: Yields (only for covered calls) */}
                {!isMultiLeg && (
                <div className="grid grid-cols-2 gap-4 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">Rendimento</p>
                    <div className="flex items-center justify-center gap-1">
                      <BarChart3 className="w-4 h-4 text-green-500" />
                      <span className="text-xl font-semibold text-green-500">
                        {formatPercentage(metrics.yieldPct)}
                      </span>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Annualizzato</p>
                    <div className="flex items-center justify-center gap-1">
                      <BarChart3 className="w-4 h-4 text-green-500" />
                      <span className="text-xl font-semibold text-green-500">
                        {formatPercentage(metrics.annualizedYieldPct)}
                      </span>
                    </div>
                  </div>
                </div>
                )}

                {/* First operation date - always visible under yields */}
                <div className="text-center text-xs text-muted-foreground pt-1">
                  📅 Prima operazione: {metrics.firstOperationDate 
                    ? formatDateDisplay(metrics.firstOperationDate)
                    : <span className="italic">- (non trovata nel file)</span>
                  }
                </div>

                {/* Collapsible: Other data */}
                <Accordion type="single" collapsible className="border-t pt-2">
                  <AccordionItem value="other-data" className="border-none">
                    <AccordionTrigger className="text-sm py-2 hover:no-underline">
                      📊 Altri dati
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3 pt-2">
                        {/* Summary counts */}
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div className="text-muted-foreground">Ordini trovati:</div>
                          <div className="text-right font-medium">{metrics.ordersFound}</div>
                          
                          <div className="text-muted-foreground">Vendite / Acquisti:</div>
                          <div className="text-right">
                            <span className="text-green-500 font-medium">{metrics.sells}</span>
                            {' / '}
                            <span className="text-red-500 font-medium">{metrics.buys}</span>
                          </div>
                        </div>

                        {/* Premium breakdown */}
                        <div className="border-t pt-2 space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Lordo Premi:</span>
                            <span>{formatCurrency(metrics.grossPremium, 'USD')}</span>
                          </div>
                          
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Commissioni:</span>
                            <span className="text-red-500">-{formatCurrency(metrics.commissions, 'USD')}</span>
                          </div>
                          
                          <div className="flex justify-between text-sm border-t pt-1">
                            <span className="text-muted-foreground">Netto Commissioni:</span>
                            <span className="text-green-500 font-medium">{formatCurrency(metrics.netPremium, 'USD')}</span>
                          </div>
                        </div>

                        {/* Per-share values */}
                        <div className="border-t pt-2 space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Lordo Unitario:</span>
                            <span>{formatCurrency(metrics.grossPerShare, 'USD')}</span>
                          </div>
                        </div>


                        {/* Transaction cost input */}
                        <div className="border-t pt-3 space-y-2">
                          <Label htmlFor="transactionCost" className="text-sm text-muted-foreground">
                            Commissione per lotto (USD)
                          </Label>
                          <Input
                            id="transactionCost"
                            type="number"
                            min="0"
                            step="0.01"
                            value={transactionCost}
                            onChange={(e) => handleTransactionCostChange(e.target.value)}
                            className="max-w-[120px]"
                          />
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </CardContent>
            </Card>
          )}

          {/* Order Details (Collapsible with removal) */}
          {metrics && filteredOrders.length > 0 && (
            <Card>
              <CardContent className="pt-4">
                <Accordion type="single" collapsible>
                  <AccordionItem value="orders" className="border-none">
                    <AccordionTrigger className="text-sm py-2 hover:no-underline">
                      <span className="flex items-center gap-2">
                        📋 Operazioni ({filteredOrders.length})
                        {lastOperationDate && (
                          <span className="text-muted-foreground font-normal">
                            — Ultima: {formatDateDisplay(lastOperationDate)}
                          </span>
                        )}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs w-8">Op.</TableHead>
                              <TableHead className="text-xs">Simbolo</TableHead>
                              <TableHead className="text-xs">Scad.</TableHead>
                              <TableHead className="text-xs text-right">Qtà</TableHead>
                              <TableHead className="text-xs text-right">Prezzo</TableHead>
                              <TableHead className="text-xs text-right">Valore</TableHead>
                              <TableHead className="text-xs w-8"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredOrders.map((order, idx) => (
                              <TableRow key={idx}>
                                <TableCell className={`text-xs ${order.operation === 'sell' ? 'text-green-500' : 'text-red-500'}`}>
                                  {order.operation === 'sell' ? 'V' : 'A'}
                                </TableCell>
                                <TableCell className="text-xs font-mono">
                                  {order.symbol}
                                  {order.optionType === 'PUT' && (
                                    <Badge variant="outline" className="text-[10px] ml-1 px-1 py-0">PUT</Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">{order.expiryDate ?? '—'}</TableCell>
                                <TableCell className="text-xs text-right">{order.quantity}</TableCell>
                                <TableCell className="text-xs text-right">{formatNumber(order.avgPrice, 2)}</TableCell>
                                <TableCell className={`text-xs text-right ${order.operation === 'sell' ? 'text-green-500' : 'text-red-500'}`}>
                                  {order.operation === 'sell' ? '+' : '-'}{formatCurrency(order.orderValue, 'USD')}
                                </TableCell>
                                <TableCell className="text-xs">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                    onClick={() => handleRemoveOrder(idx)}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </CardContent>
            </Card>
          )}

          {/* Action buttons */}
          <div className="flex justify-between">
            <div className="flex gap-2">
              {metrics && (
                <>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleSave}
                    disabled={isUpserting || !hasUnsavedChanges}
                  >
                    <Save className="w-4 h-4 mr-1" />
                    {isUpserting ? 'Salvataggio...' : 'Salva'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReset}
                  >
                    <RefreshCw className="w-4 h-4 mr-1" />
                    Reset
                  </Button>
                  {filteredOrders.length > 0 && ticker && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const url = buildOptionStratUrlFromOrders(filteredOrders, ticker, isMultiLeg ? (strategyType === 'iron_condor' ? 'Iron Condor' : strategyType === 'double_diagonal' ? 'Double Diagonal' : null) : null);
                        window.open(url, '_blank', 'noopener,noreferrer');
                      }}
                    >
                      <ExternalLink className="w-4 h-4 mr-1" />
                      OptionStrat
                    </Button>
                  )}
                </>
              )}
            </div>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Chiudi
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
