import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileSpreadsheet, Upload, Calculator, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  parseOrderFile, 
  filterAndCalculateCallPremiums, 
  calculatePremiumMetrics,
  PremiumMetrics,
  ParsedOrder
} from '@/lib/orderFileParser';
import { formatCurrency } from '@/lib/formatters';

interface CallPremiumCalculatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  underlying: string;
  ticker?: string;
  contractsInPortfolio: number;
}

export function CallPremiumCalculatorDialog({
  open,
  onOpenChange,
  underlying,
  ticker,
  contractsInPortfolio,
}: CallPremiumCalculatorDialogProps) {
  const [transactionCost, setTransactionCost] = useState<number>(10);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<PremiumMetrics | null>(null);
  const [filteredOrders, setFilteredOrders] = useState<ParsedOrder[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    if (!ticker) {
      setError('Ticker non disponibile per questa Covered Call');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setFileName(file.name);

    try {
      const orders = await parseOrderFile(file);
      const result = filterAndCalculateCallPremiums(orders, ticker);
      const calculatedMetrics = calculatePremiumMetrics(result, transactionCost, contractsInPortfolio);
      
      setMetrics(calculatedMetrics);
      setFilteredOrders(result.filteredOrders);
    } catch (err) {
      console.error('Error processing file:', err);
      setError(err instanceof Error ? err.message : 'Errore durante l\'elaborazione del file');
      setMetrics(null);
      setFilteredOrders([]);
    } finally {
      setIsProcessing(false);
    }
  }, [ticker, transactionCost, contractsInPortfolio]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
    maxFiles: 1,
  });

  // Recalculate when transaction cost changes
  const handleTransactionCostChange = (value: string) => {
    const cost = parseFloat(value) || 0;
    setTransactionCost(cost);
    
    if (metrics && filteredOrders.length > 0) {
      // Recalculate with new transaction cost
      const ordersCount = filteredOrders.length;
      const newCommissions = ordersCount * cost;
      const newNetPremium = metrics.grossPremium - newCommissions;
      const totalShares = contractsInPortfolio * 100;
      
      setMetrics({
        ...metrics,
        commissions: newCommissions,
        netPremium: newNetPremium,
        netPerShare: totalShares > 0 ? newNetPremium / totalShares : 0,
      });
    }
  };

  const handleReset = () => {
    setMetrics(null);
    setFilteredOrders([]);
    setFileName(null);
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
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
          {/* File Upload */}
          <div
            {...getRootProps()}
            className={`
              border-2 border-dashed rounded-lg p-6 text-center cursor-pointer
              transition-colors
              ${isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}
              ${isProcessing ? 'opacity-50 pointer-events-none' : ''}
            `}
          >
            <input {...getInputProps()} />
            <FileSpreadsheet className="w-10 h-10 mx-auto mb-2 text-muted-foreground" />
            {isDragActive ? (
              <p className="text-sm text-primary">Rilascia il file qui...</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {fileName ? (
                    <>File caricato: <span className="font-medium">{fileName}</span></>
                  ) : (
                    <>Trascina un file Excel o clicca per selezionarlo</>
                  )}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Formati supportati: .xls, .xlsx
                </p>
              </>
            )}
            {isProcessing && (
              <p className="text-sm text-primary mt-2">Elaborazione in corso...</p>
            )}
          </div>

          {/* Transaction Cost Input */}
          <div className="space-y-2">
            <Label htmlFor="transactionCost">Costo unitario transazione (USD)</Label>
            <Input
              id="transactionCost"
              type="number"
              min="0"
              step="0.01"
              value={transactionCost}
              onChange={(e) => handleTransactionCostChange(e.target.value)}
              className="max-w-[150px]"
            />
          </div>

          {/* Error Alert */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Results */}
          {metrics && (
            <Card>
              <CardContent className="pt-4 space-y-4">
                {/* Summary */}
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-muted-foreground">Ordini trovati:</div>
                  <div className="font-medium text-right">{metrics.ordersFound}</div>
                  
                  <div className="text-muted-foreground">Vendite / Acquisti:</div>
                  <div className="font-medium text-right">
                    <span className="text-green-500">{metrics.sells}</span>
                    {' / '}
                    <span className="text-red-500">{metrics.buys}</span>
                  </div>
                </div>

                <div className="border-t pt-3 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Lordo Premi:</span>
                    <span className="font-semibold">{formatCurrency(metrics.grossPremium, 'USD')}</span>
                  </div>
                  
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Commissioni:</span>
                    <span className="text-red-500">-{formatCurrency(metrics.commissions, 'USD')}</span>
                  </div>
                  
                  <div className="flex justify-between text-sm border-t pt-2">
                    <span className="text-muted-foreground">Netto Commissioni:</span>
                    <span className="font-semibold text-green-500">{formatCurrency(metrics.netPremium, 'USD')}</span>
                  </div>
                </div>

                <div className="border-t pt-3 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Lordo Unitario:</span>
                    <span className="font-medium">{formatCurrency(metrics.grossPerShare, 'USD')}</span>
                  </div>
                  
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Netto Unitario:</span>
                    <span className="font-medium text-green-500">{formatCurrency(metrics.netPerShare, 'USD')}</span>
                  </div>
                  
                  <p className="text-xs text-muted-foreground mt-1">
                    Calcolato su {contractsInPortfolio} contratti ({contractsInPortfolio * 100} azioni)
                  </p>
                </div>

                {/* Order Details (Collapsible) */}
                {filteredOrders.length > 0 && (
                  <Accordion type="single" collapsible className="border-t pt-2">
                    <AccordionItem value="orders" className="border-none">
                      <AccordionTrigger className="text-sm py-2 hover:no-underline">
                        Dettaglio ordini ({filteredOrders.length})
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="max-h-[200px] overflow-y-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">Op.</TableHead>
                                <TableHead className="text-xs">Simbolo</TableHead>
                                <TableHead className="text-xs text-right">Qtà</TableHead>
                                <TableHead className="text-xs text-right">Prezzo</TableHead>
                                <TableHead className="text-xs text-right">Valore</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {filteredOrders.map((order, idx) => (
                                <TableRow key={idx}>
                                  <TableCell className={`text-xs ${order.operation === 'sell' ? 'text-green-500' : 'text-red-500'}`}>
                                    {order.operation === 'sell' ? 'V' : 'A'}
                                  </TableCell>
                                  <TableCell className="text-xs font-mono">{order.symbol}</TableCell>
                                  <TableCell className="text-xs text-right">{order.quantity}</TableCell>
                                  <TableCell className="text-xs text-right">{order.avgPrice.toFixed(2)}</TableCell>
                                  <TableCell className={`text-xs text-right ${order.operation === 'sell' ? 'text-green-500' : 'text-red-500'}`}>
                                    {order.operation === 'sell' ? '+' : '-'}{formatCurrency(order.orderValue, 'USD')}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            {metrics && (
              <Button variant="outline" onClick={handleReset}>
                <Upload className="w-4 h-4 mr-2" />
                Carica nuovo file
              </Button>
            )}
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Chiudi
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
