import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Check, X, Plus, Loader2 } from 'lucide-react';
import { ReconciliationItem, LegStatus } from '@/lib/strategyReconciliation';
import { UpsertConfigParams, PositionSignature, STRATEGY_TYPE_LABELS, StrategyConfiguration } from '@/hooks/useStrategyConfigurations';
import { ScrollArea } from '@/components/ui/scroll-area';

const STRATEGY_OPTIONS = [
  { value: 'covered_call', label: 'Covered Call' },
  { value: 'derisking_covered_call', label: 'De-Risking Covered Call' },
  { value: 'iron_condor', label: 'Iron Condor' },
  { value: 'double_diagonal', label: 'Double Diagonal' },
  { value: 'naked_put', label: 'Naked Put' },
  { value: 'put_spread', label: 'Put Spread' },
  { value: 'diagonal_put_spread', label: 'Diagonal Put Spread' },
  { value: 'leap_call', label: 'LEAP Call' },
  { value: 'other', label: 'Altre Strategie' },
];

interface StrategyReconciliationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ReconciliationItem[];
  allConfigs: StrategyConfiguration[];
  onSave: (configs: UpsertConfigParams[]) => Promise<void>;
  isSaving: boolean;
}

interface ItemState {
  selectedLegs: Set<number>; // indices of legs to include
  strategyType: string;
}

export function StrategyReconciliationDialog({
  open,
  onOpenChange,
  items,
  allConfigs,
  onSave,
  isSaving,
}: StrategyReconciliationDialogProps) {
  const [itemStates, setItemStates] = useState<Map<string, ItemState>>(new Map());

  // Initialize states lazily
  const getItemState = (item: ReconciliationItem): ItemState => {
    const key = item.config.id;
    if (itemStates.has(key)) return itemStates.get(key)!;
    // Default: select present + new legs, exclude missing
    const selected = new Set<number>();
    item.legs.forEach((leg, i) => {
      if (leg.status === 'present' || leg.status === 'new') {
        selected.add(i);
      }
    });
    return { selectedLegs: selected, strategyType: item.strategyType };
  };

  const updateItemState = (configId: string, update: Partial<ItemState>) => {
    setItemStates(prev => {
      const next = new Map(prev);
      const current = next.get(configId) || { selectedLegs: new Set(), strategyType: '' };
      next.set(configId, { ...current, ...update });
      return next;
    });
  };

  const toggleLeg = (configId: string, legIndex: number, item: ReconciliationItem) => {
    const state = getItemState(item);
    const newSelected = new Set(state.selectedLegs);
    if (newSelected.has(legIndex)) {
      newSelected.delete(legIndex);
    } else {
      newSelected.add(legIndex);
    }
    updateItemState(configId, { selectedLegs: newSelected });
  };

  const handleSave = async () => {
    const changedConfigIds = new Set(items.map(item => item.config.id));
    const configs: UpsertConfigParams[] = [];

    // Add unchanged configs as-is
    for (const config of allConfigs) {
      if (changedConfigIds.has(config.id)) continue;
      configs.push({
        underlying: config.underlying,
        strategy_type: config.strategy_type,
        position_signatures: config.position_signatures as unknown as PositionSignature[],
        is_synthetic: config.is_synthetic,
        linked_stock_id: config.linked_stock_id,
      });
    }

    // Add updated configs from reconciliation
    for (const item of items) {
      const state = getItemState(item);
      const selectedSignatures: PositionSignature[] = [];

      item.legs.forEach((leg, i) => {
        if (state.selectedLegs.has(i)) {
          selectedSignatures.push(leg.signature);
        }
      });

      if (selectedSignatures.length > 0) {
        configs.push({
          underlying: item.underlying,
          strategy_type: state.strategyType,
          position_signatures: selectedSignatures,
          is_synthetic: item.config.is_synthetic,
          linked_stock_id: item.config.linked_stock_id,
        });
      }
    }

    await onSave(configs);
    onOpenChange(false);
  };

  const statusIcon = (status: LegStatus['status']) => {
    switch (status) {
      case 'present':
        return <Check className="w-3.5 h-3.5 text-green-500" />;
      case 'missing':
        return <X className="w-3.5 h-3.5 text-destructive" />;
      case 'new':
        return <Plus className="w-3.5 h-3.5 text-blue-500" />;
    }
  };

  const statusBadge = (status: LegStatus['status']) => {
    switch (status) {
      case 'present':
        return <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-green-500/50 text-green-500">Presente</Badge>;
      case 'missing':
        return <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-destructive/50 text-destructive">Rimossa</Badge>;
      case 'new':
        return <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-500/50 text-blue-500">Nuova</Badge>;
    }
  };

  if (items.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-500" />
            Configurazioni da aggiornare
          </DialogTitle>
          <DialogDescription>
            Sono state rilevate differenze tra le configurazioni salvate e le posizioni attuali.
            Verifica e aggiorna le strategie per {items.length} sottostant{items.length === 1 ? 'e' : 'i'}.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-4 py-2">
            {items.map((item) => {
              const state = getItemState(item);

              return (
                <Card key={item.config.id} className="border-yellow-500/30">
                  <CardContent className="pt-4 pb-3 space-y-3">
                    {/* Header */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-sm">{item.underlying}</div>
                      <Select
                        value={state.strategyType}
                        onValueChange={(v) => updateItemState(item.config.id, { strategyType: v })}
                      >
                        <SelectTrigger className="w-[200px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STRATEGY_OPTIONS.map(opt => (
                            <SelectItem key={opt.value} value={opt.value} className="text-xs">
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Legs */}
                    <div className="space-y-1.5">
                      {item.legs.map((leg, i) => {
                        const isChecked = state.selectedLegs.has(i);
                        const isMissing = leg.status === 'missing';

                        return (
                          <div
                            key={`${item.config.id}-${i}`}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${
                              isMissing
                                ? 'bg-destructive/5 line-through text-muted-foreground'
                                : isChecked
                                  ? 'bg-accent/50'
                                  : 'bg-muted/30'
                            }`}
                          >
                            {!isMissing && (
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={() => toggleLeg(item.config.id, i, item)}
                                className="h-3.5 w-3.5"
                              />
                            )}
                            {isMissing && <span className="w-3.5" />}
                            {statusIcon(leg.status)}
                            <span className="font-mono flex-1">{leg.label}</span>
                            {statusBadge(leg.status)}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Ignora
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Salva aggiornamenti
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
