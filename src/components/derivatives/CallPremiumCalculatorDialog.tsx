import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileSpreadsheet, Upload, Calculator, AlertCircle, Trash2, BarChart3, Save, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  parseOrderFile, 
  filterAndCalculateCallPremiums, 
  calculatePremiumMetrics,
  findFirstOperationDate,
  findLastOperationDate,
  mergeOrders,
  
  PremiumMetrics,
  ParsedOrder,
  OrderParseResult
} from '@/lib/orderFileParser';
import { formatCurrency, formatPercentage, formatNumber } from '@/lib/formatters';
import { useCoveredCallPremiums } from '@/hooks/useCoveredCallPremiums';
import { usePortfolio } from '@/hooks/usePortfolio';
import { toast } from 'sonner';

interface CallPremiumCalculatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  underlying: string;
  ticker?: string;
  optionSymbol: string;
  contractsInPortfolio: number;
  underlyingPrice: number;
}

export function CallPremiumCalculatorDialog({
  open,
  onOpenChange,
  underlying,
  ticker,
  optionSymbol,
  contractsInPortfolio,
  underlyingPrice,
}: CallPremiumCalculatorDialogProps) {
  const { portfolio } = usePortfolio();
  const { getPremiumByTickerAndSymbol, upsertPremium, deletePremium, isUpserting, isLoading: isLoadingPremiums } = useCoveredCallPremiums(portfolio?.id);
  
  const [transactionCost, setTransactionCost] = useState<number>(10);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<PremiumMetrics | null>(null);
  const [filteredOrders, setFilteredOrders] = useState<ParsedOrder[]>([]);
  const [parseResult, setParseResult] = useState<OrderParseResult | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastOperationDate, setLastOperationDate] = useState<string | null>(null);

  // Load saved data when dialog opens
  useEffect(() => {
    if (open && ticker && !isLoadingPremiums) {
      const saved = getPremiumByTickerAndSymbol(ticker, optionSymbol);
      if (saved && saved.orders_json.length > 0) {
        setTransactionCost(saved.transaction_cost);
        setFilteredOrders(saved.orders_json);
        setLastOperationDate(saved.last_operation_date);
        recalculateMetrics(saved.orders_json, saved.transaction_cost);
        setHasUnsavedChanges(false);
      }
    }
  }, [open, ticker, optionSymbol, isLoadingPremiums]);

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
      grossPremium: Math.abs(netPremium),
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
      setError('Ticker non disponibile per questa Covered Call');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const orders = await parseOrderFile(file);
      const result = filterAndCalculateCallPremiums(orders, ticker, underlyingPrice);
      
      // Merge with existing orders (cumulative)
      const mergedOrders = mergeOrders(filteredOrders, result.filteredOrders);
      const newOrdersCount = mergedOrders.length - filteredOrders.length;
      
      setFilteredOrders(mergedOrders);
      recalculateMetrics(mergedOrders, transactionCost);
      setHasUnsavedChanges(true);
      
      if (newOrdersCount > 0) {
        toast.success(`Aggiunte ${newOrdersCount} nuove operazioni`);
      } else {
        toast.info('Nessuna nuova operazione trovata');
      }
    } catch (err) {
      console.error('Error processing file:', err);
      setError(err instanceof Error ? err.message : 'Errore durante l\'elaborazione del file');
    } finally {
      setIsProcessing(false);
    }
  }, [ticker, transactionCost, filteredOrders, underlyingPrice, recalculateMetrics]);

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

  // Handle order removal
  const handleRemoveOrder = (index: number) => {
    const newOrders = filteredOrders.filter((_, i) => i !== index);
    setFilteredOrders(newOrders);
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
        net_per_share: metrics.netPerShare,
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
        await deletePremium(ticker);
        setMetrics(null);
        setFilteredOrders([]);
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
            Calcola Premi CALL
          </DialogTitle>
          <DialogDescription>
            Sottostante: <span className="font-semibold">{underlying}</span>
            {ticker && <span className="text-muted-foreground"> ({ticker})</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Netto Unitario</p>
                  <p className="text-3xl font-bold text-primary">
                    {formatCurrency(metrics.netPerShare, 'USD')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    su {contractsInPortfolio} contratti ({contractsInPortfolio * 100} azioni)
                  </p>
                </div>

                {/* Secondary: Yields */}
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
                            Costo unitario transazione (USD)
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
                                <TableCell className="text-xs font-mono">{order.symbol}</TableCell>
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
