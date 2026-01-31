import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { AvailableStock } from '@/types/derivativeOverrides';
import { Position } from '@/types/portfolio';
import { formatExpiryMMY } from './utils';

interface LinkStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  option: Position;
  availableStocks: AvailableStock[];
  contractsNeeded: number;
  onConfirm: (stockId: string) => void;
  isLoading?: boolean;
}

export function LinkStockDialog({
  open,
  onOpenChange,
  option,
  availableStocks,
  contractsNeeded,
  onConfirm,
  isLoading
}: LinkStockDialogProps) {
  const [selectedStockId, setSelectedStockId] = useState<string>('');

  const handleConfirm = () => {
    if (selectedStockId) {
      onConfirm(selectedStockId);
      setSelectedStockId('');
    }
  };

  const handleClose = () => {
    setSelectedStockId('');
    onOpenChange(false);
  };

  const optionDescription = `${option.option_type?.toUpperCase()} ${option.underlying || option.description} ${option.strike_price} ${formatExpiryMMY(option.expiry_date)}`;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Accoppia con Titolo</DialogTitle>
          <DialogDescription>
            {optionDescription} ({Math.abs(option.quantity)} contratto/i)
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <p className="text-sm text-muted-foreground mb-4">
            Seleziona il titolo da associare per la copertura:
          </p>

          {availableStocks.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground">
              <p className="text-sm">Nessun titolo disponibile per questa opzione.</p>
              <p className="text-xs mt-1">
                Verifica che ci siano azioni del sottostante in portafoglio con contratti liberi.
              </p>
            </div>
          ) : (
            <RadioGroup 
              value={selectedStockId} 
              onValueChange={setSelectedStockId}
              className="space-y-3"
            >
              {availableStocks.map((stock) => {
                const canCover = stock.availableContracts >= contractsNeeded;
                const usagePercentage = (stock.usedShares / stock.totalShares) * 100;
                
                return (
                  <div 
                    key={stock.positionId}
                    className={`flex items-start space-x-3 p-3 border rounded-lg transition-colors ${
                      canCover 
                        ? 'hover:bg-muted/50 cursor-pointer' 
                        : 'opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <RadioGroupItem 
                      value={stock.positionId} 
                      id={stock.positionId}
                      disabled={!canCover}
                      className="mt-1"
                    />
                    <Label 
                      htmlFor={stock.positionId} 
                      className={`flex-1 ${canCover ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                    >
                      <div className="font-medium text-sm">{stock.description}</div>
                      <div className="text-xs text-muted-foreground mt-1 space-y-1">
                        <div className="flex justify-between">
                          <span>{stock.totalShares} azioni totali</span>
                          <span>{stock.usedShares} usate</span>
                        </div>
                        <Progress value={usagePercentage} className="h-1.5" />
                        <div className="flex justify-between">
                          <span className={canCover ? 'text-green-600' : 'text-destructive'}>
                            {stock.availableShares} disponibili ({stock.availableContracts} contratti)
                          </span>
                          {!canCover && (
                            <span className="text-destructive">
                              Insufficienti
                            </span>
                          )}
                        </div>
                      </div>
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Annulla
          </Button>
          <Button 
            onClick={handleConfirm} 
            disabled={!selectedStockId || isLoading}
          >
            {isLoading ? 'Salvando...' : 'Conferma'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
