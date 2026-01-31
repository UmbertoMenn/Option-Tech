import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Position } from '@/types/portfolio';
import { MultiLegStrategyType } from '@/types/derivativeOverrides';
import { useDerivativeOverrides } from '@/hooks/useDerivativeOverrides';
import { formatExpiryMMY, normalizeForMatching } from './utils';

interface CreateMultiLegDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableOptions: Position[];
}

export function CreateMultiLegDialog({
  open,
  onOpenChange,
  availableOptions
}: CreateMultiLegDialogProps) {
  const [strategyType, setStrategyType] = useState<MultiLegStrategyType>('iron_condor');
  const [selectedUnderlying, setSelectedUnderlying] = useState<string>('');
  const [soldPutId, setSoldPutId] = useState<string>('');
  const [boughtPutId, setBoughtPutId] = useState<string>('');
  const [soldCallId, setSoldCallId] = useState<string>('');
  const [boughtCallId, setBoughtCallId] = useState<string>('');

  const { createMultiLegOverride, isCreatingMultiLeg } = useDerivativeOverrides();

  // Get unique underlyings
  const underlyings = useMemo(() => {
    const uniqueUnderlyings = new Map<string, string>();
    for (const opt of availableOptions) {
      const key = normalizeForMatching(opt.underlying || opt.description);
      const displayName = opt.underlying || opt.description;
      if (!uniqueUnderlyings.has(key)) {
        uniqueUnderlyings.set(key, displayName);
      }
    }
    return Array.from(uniqueUnderlyings.entries()).map(([key, name]) => ({ key, name }));
  }, [availableOptions]);

  // Filter options by selected underlying
  const filteredOptions = useMemo(() => {
    if (!selectedUnderlying) return [];
    return availableOptions.filter(opt => 
      normalizeForMatching(opt.underlying || opt.description) === selectedUnderlying
    );
  }, [availableOptions, selectedUnderlying]);

  // Separate by type
  const soldPuts = useMemo(() => 
    filteredOptions.filter(o => o.option_type === 'put' && o.quantity < 0),
    [filteredOptions]
  );
  const boughtPuts = useMemo(() => 
    filteredOptions.filter(o => o.option_type === 'put' && o.quantity > 0),
    [filteredOptions]
  );
  const soldCalls = useMemo(() => 
    filteredOptions.filter(o => o.option_type === 'call' && o.quantity < 0),
    [filteredOptions]
  );
  const boughtCalls = useMemo(() => 
    filteredOptions.filter(o => o.option_type === 'call' && o.quantity > 0),
    [filteredOptions]
  );

  const formatOptionLabel = (opt: Position) => {
    const direction = opt.quantity < 0 ? 'V' : 'A';
    return `${opt.option_type?.toUpperCase()} ${opt.strike_price} ${formatExpiryMMY(opt.expiry_date)} [${direction}${Math.abs(opt.quantity)}]`;
  };

  const canCreate = soldPutId && boughtPutId && soldCallId && boughtCallId;

  const handleCreate = async () => {
    if (!canCreate) return;

    try {
      await createMultiLegOverride({
        strategyType,
        soldPutId,
        boughtPutId,
        soldCallId,
        boughtCallId
      });
      handleClose();
    } catch (error) {
      console.error('Error creating multi-leg strategy:', error);
    }
  };

  const handleClose = () => {
    setStrategyType('iron_condor');
    setSelectedUnderlying('');
    setSoldPutId('');
    setBoughtPutId('');
    setSoldCallId('');
    setBoughtCallId('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Crea Strategia Manuale</DialogTitle>
          <DialogDescription>
            Seleziona 4 gambe per creare una strategia multi-leg
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Step 1: Strategy Type */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Tipo Strategia</Label>
            <RadioGroup 
              value={strategyType} 
              onValueChange={(v) => setStrategyType(v as MultiLegStrategyType)}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="iron_condor" id="iron_condor" />
                <Label htmlFor="iron_condor" className="cursor-pointer">Iron Condor</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="double_diagonal" id="double_diagonal" />
                <Label htmlFor="double_diagonal" className="cursor-pointer">Double Diagonal</Label>
              </div>
            </RadioGroup>
          </div>

          {/* Step 2: Select Underlying */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Sottostante</Label>
            <Select value={selectedUnderlying} onValueChange={setSelectedUnderlying}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona sottostante" />
              </SelectTrigger>
              <SelectContent>
                {underlyings.map(({ key, name }) => (
                  <SelectItem key={key} value={key}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Step 3: Select Legs */}
          {selectedUnderlying && (
            <div className="space-y-4">
              <Label className="text-sm font-medium">Seleziona Gambe</Label>
              
              <div className="grid grid-cols-2 gap-4">
                {/* PUT Side */}
                <div className="space-y-3 p-3 border rounded-lg">
                  <div className="text-sm font-medium text-center">PUT Spread</div>
                  
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">PUT Venduta</Label>
                    <Select value={soldPutId} onValueChange={setSoldPutId}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Seleziona..." />
                      </SelectTrigger>
                      <SelectContent>
                        {soldPuts.map(opt => (
                          <SelectItem key={opt.id} value={opt.id} className="text-xs">
                            {formatOptionLabel(opt)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">PUT Acquistata</Label>
                    <Select value={boughtPutId} onValueChange={setBoughtPutId}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Seleziona..." />
                      </SelectTrigger>
                      <SelectContent>
                        {boughtPuts.map(opt => (
                          <SelectItem key={opt.id} value={opt.id} className="text-xs">
                            {formatOptionLabel(opt)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* CALL Side */}
                <div className="space-y-3 p-3 border rounded-lg">
                  <div className="text-sm font-medium text-center">CALL Spread</div>
                  
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">CALL Venduta</Label>
                    <Select value={soldCallId} onValueChange={setSoldCallId}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Seleziona..." />
                      </SelectTrigger>
                      <SelectContent>
                        {soldCalls.map(opt => (
                          <SelectItem key={opt.id} value={opt.id} className="text-xs">
                            {formatOptionLabel(opt)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">CALL Acquistata</Label>
                    <Select value={boughtCallId} onValueChange={setBoughtCallId}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Seleziona..." />
                      </SelectTrigger>
                      <SelectContent>
                        {boughtCalls.map(opt => (
                          <SelectItem key={opt.id} value={opt.id} className="text-xs">
                            {formatOptionLabel(opt)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Validation messages */}
              {soldPuts.length === 0 && (
                <p className="text-xs text-destructive">Nessuna PUT venduta disponibile</p>
              )}
              {boughtPuts.length === 0 && (
                <p className="text-xs text-destructive">Nessuna PUT acquistata disponibile</p>
              )}
              {soldCalls.length === 0 && (
                <p className="text-xs text-destructive">Nessuna CALL venduta disponibile</p>
              )}
              {boughtCalls.length === 0 && (
                <p className="text-xs text-destructive">Nessuna CALL acquistata disponibile</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Annulla
          </Button>
          <Button 
            onClick={handleCreate} 
            disabled={!canCreate || isCreatingMultiLeg}
          >
            {isCreatingMultiLeg ? 'Creando...' : 'Crea Strategia'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
