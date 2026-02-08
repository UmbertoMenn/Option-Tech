import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Trash2, Loader2 } from 'lucide-react';
import { ClearMode } from '@/hooks/useClearPortfolio';

interface ClearDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portfolioName: string;
  onConfirm: (mode: ClearMode) => Promise<void>;
  isClearing: boolean;
}

export function ClearDataDialog({
  open,
  onOpenChange,
  portfolioName,
  onConfirm,
  isClearing,
}: ClearDataDialogProps) {
  const [selectedMode, setSelectedMode] = useState<ClearMode>('quick');

  const handleConfirm = async () => {
    await onConfirm(selectedMode);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Pulisci Dati Portfolio
          </DialogTitle>
          <DialogDescription>
            Stai per eliminare i dati del portfolio "{portfolioName}".
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <p className="text-sm text-muted-foreground mb-4">
            Scegli cosa eliminare:
          </p>

          <RadioGroup
            value={selectedMode}
            onValueChange={(value) => setSelectedMode(value as ClearMode)}
            className="space-y-4"
          >
            <div className="flex items-start space-x-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors">
              <RadioGroupItem value="quick" id="quick" className="mt-1" />
              <Label htmlFor="quick" className="flex-1 cursor-pointer">
                <span className="font-medium">Pulizia Rapida</span>
                <p className="text-sm text-muted-foreground mt-1">
                  Elimina posizioni, strategie e avvisi.
                  <br />
                  <span className="text-primary">Mantiene dati storici e versamenti.</span>
                </p>
              </Label>
            </div>

            <div className="flex items-start space-x-3 p-3 rounded-lg border border-destructive/50 hover:bg-destructive/5 transition-colors">
              <RadioGroupItem value="full" id="full" className="mt-1" />
              <Label htmlFor="full" className="flex-1 cursor-pointer">
                <span className="font-medium text-destructive">Reset Completo</span>
                <p className="text-sm text-muted-foreground mt-1">
                  Elimina <strong>TUTTO</strong> inclusi dati storici e versamenti.
                  <br />
                  <span className="text-destructive font-medium">⚠️ Azione irreversibile!</span>
                </p>
              </Label>
            </div>
          </RadioGroup>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isClearing}
          >
            Annulla
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isClearing}
          >
            {isClearing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Pulizia in corso...
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" />
                Pulisci
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
