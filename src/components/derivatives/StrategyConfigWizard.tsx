import { useState, useMemo, useCallback } from 'react';
import { Position } from '@/types/portfolio';
import { normalizeForMatching, findUnderlyingStock } from '@/lib/derivativeStrategies';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Settings2, Check, Zap, Plus, X, Wand2 } from 'lucide-react';
import { UpsertConfigParams, PositionSignature, StrategyConfiguration } from '@/hooks/useStrategyConfigurations';

// Format expiry as MMM/YY
function formatExpiryMMY(date: string | null | undefined): string {
  if (!date) return '-';
  const months = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
  const d = new Date(date);
  return `${months[d.getMonth()]}/${d.getFullYear().toString().slice(-2)}`;
}

const STRATEGY_OPTIONS = [
  { value: 'covered_call', label: 'Covered Call' },
  { value: 'derisking_covered_call', label: 'De-Risking Covered Call' },
  { value: 'iron_condor', label: 'Iron Condor' },
  { value: 'double_diagonal', label: 'Double Diagonal' },
  { value: 'naked_put', label: 'Naked Put' },
  { value: 'leap_call', label: 'LEAP Call' },
  { value: 'other', label: 'Altre Strategie' },
];

interface WizardStrategy {
  id: string;
  positions: Position[];
  strategyType: string;
  isSynthetic: boolean;
  suggestedType: string;
}

interface StrategyConfigWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  derivatives: Position[];
  allPositions: Position[];
  existingConfigs: StrategyConfiguration[];
  onSave: (configs: UpsertConfigParams[]) => Promise<void>;
  isSaving: boolean;
  filterUnderlyings?: string[];
}

function buildSignatures(positions: Position[]): PositionSignature[] {
  return positions
    .filter(p => p.asset_type === 'derivative')
    .map(o => ({
      option_type: o.option_type || 'unknown',
      strike: o.strike_price || 0,
      expiry: o.expiry_date || '',
      quantity_sign: o.quantity >= 0 ? 1 : -1,
    }));
}

function positionLabel(p: Position): string {
  if (p.asset_type === 'stock' || p.asset_type === 'etf') {
    return `${p.description} (${p.quantity} azioni)`;
  }
  const side = p.quantity < 0 ? 'V' : 'A';
  const type = p.option_type?.toUpperCase() || '?';
  const strike = p.strike_price || '?';
  const expiry = formatExpiryMMY(p.expiry_date);
  const qty = Math.abs(p.quantity) > 1 ? ` ×${Math.abs(p.quantity)}` : '';
  return `${side} ${type} ${strike} ${expiry}${qty}`;
}

function positionBadgeClass(p: Position): string {
  if (p.asset_type === 'stock' || p.asset_type === 'etf') return 'border-blue-500/50 text-blue-500';
  return p.quantity < 0 ? 'border-green-500/50 text-green-500' : 'border-red-500/50 text-red-500';
}

/** Auto-detect strategy type from a group of positions */
function detectStrategyType(positions: Position[]): string {
  const options = positions.filter(p => p.asset_type === 'derivative');
  const stocks = positions.filter(p => p.asset_type === 'stock' || p.asset_type === 'etf');

  const soldCalls = options.filter(o => o.option_type === 'call' && o.quantity < 0);
  const boughtCalls = options.filter(o => o.option_type === 'call' && o.quantity > 0);
  const soldPuts = options.filter(o => o.option_type === 'put' && o.quantity < 0);
  const boughtPuts = options.filter(o => o.option_type === 'put' && o.quantity > 0);
  const hasStock = stocks.some(s => s.quantity > 0);

  // 4-leg
  if (soldCalls.length >= 1 && boughtCalls.length >= 1 && soldPuts.length >= 1 && boughtPuts.length >= 1) {
    const expiries = new Set(options.map(o => o.expiry_date));
    if (expiries.size === 1) return 'iron_condor';
    if (expiries.size >= 2) return 'double_diagonal';
  }

  if (soldCalls.length > 0 && (hasStock || soldPuts.some(p => Math.abs(p.strike_price || 0) > 0))) {
    if (boughtPuts.length > 0) return 'derisking_covered_call';
    if (hasStock) return 'covered_call';
  }

  if (soldPuts.length > 0 && !hasStock && soldCalls.length === 0 && boughtCalls.length === 0) return 'naked_put';
  if (boughtCalls.length > 0 && soldCalls.length === 0 && soldPuts.length === 0) return 'leap_call';

  return 'other';
}

/** Group positions by underlying and auto-classify */
function autoClassify(derivatives: Position[], allPositions: Position[]): WizardStrategy[] {
  const stockPositions = allPositions.filter(p => p.asset_type === 'stock' || p.asset_type === 'etf');
  const groups = new Map<string, Position[]>();

  for (const d of derivatives) {
    const key = normalizeForMatching(d.underlying || d.description || '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  const strategies: WizardStrategy[] = [];
  let idCounter = 0;

  for (const [key, options] of groups) {
    // Find matching stocks
    const matchingStocks = stockPositions.filter(s => {
      const stockKey = normalizeForMatching(s.description || s.ticker || '');
      return stockKey === key || stockKey.includes(key) || key.includes(stockKey);
    });

    const positionsInGroup = [...options];
    if (matchingStocks.length > 0) positionsInGroup.push(...matchingStocks);

    const suggested = detectStrategyType(positionsInGroup);
    strategies.push({
      id: `auto-${idCounter++}`,
      positions: positionsInGroup,
      strategyType: suggested,
      isSynthetic: false,
      suggestedType: suggested,
    });
  }

  return strategies;
}

let nextId = 0;
function genId() { return `ws-${Date.now()}-${nextId++}`; }

export function StrategyConfigWizard({
  open,
  onOpenChange,
  derivatives,
  allPositions,
  existingConfigs,
  onSave,
  isSaving,
  filterUnderlyings,
}: StrategyConfigWizardProps) {
  // All available positions (derivatives + stocks)
  const allAvailable = useMemo(() => {
    const stocks = allPositions.filter(p => p.asset_type === 'stock' || p.asset_type === 'etf');
    let derivs = derivatives;
    if (filterUnderlyings) {
      derivs = derivs.filter(d => filterUnderlyings.includes(d.underlying || ''));
    }
    return [...derivs, ...stocks];
  }, [derivatives, allPositions, filterUnderlyings]);

  const [strategies, setStrategies] = useState<WizardStrategy[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Pool = all positions not assigned to any strategy
  const assignedIds = useMemo(() => {
    const ids = new Set<string>();
    strategies.forEach(s => s.positions.forEach(p => ids.add(p.id)));
    return ids;
  }, [strategies]);

  const pool = useMemo(() => 
    allAvailable.filter(p => !assignedIds.has(p.id)),
    [allAvailable, assignedIds]
  );

  // Reset state when dialog opens
  const handleOpenChange = useCallback((isOpen: boolean) => {
    if (isOpen) {
      setStrategies([]);
      setSelectedIds(new Set());
    }
    onOpenChange(isOpen);
  }, [onOpenChange]);

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createStrategyFromSelected = () => {
    const selected = pool.filter(p => selectedIds.has(p.id));
    if (selected.length === 0) return;

    const suggested = detectStrategyType(selected);
    setStrategies(prev => [...prev, {
      id: genId(),
      positions: selected,
      strategyType: suggested,
      isSynthetic: false,
      suggestedType: suggested,
    }]);
    setSelectedIds(new Set());
  };

  const removeFromStrategy = (strategyId: string, positionId: string) => {
    setStrategies(prev => prev.map(s => {
      if (s.id !== strategyId) return s;
      const newPositions = s.positions.filter(p => p.id !== positionId);
      if (newPositions.length === 0) return null as any;
      const suggested = detectStrategyType(newPositions);
      return { ...s, positions: newPositions, suggestedType: suggested };
    }).filter(Boolean));
  };

  const deleteStrategy = (strategyId: string) => {
    setStrategies(prev => prev.filter(s => s.id !== strategyId));
  };

  const updateStrategyType = (strategyId: string, type: string) => {
    setStrategies(prev => prev.map(s => 
      s.id === strategyId ? { ...s, strategyType: type } : s
    ));
  };

  const toggleSynthetic = (strategyId: string) => {
    setStrategies(prev => prev.map(s => 
      s.id === strategyId ? { ...s, isSynthetic: !s.isSynthetic } : s
    ));
  };

  const handleAutoClassify = () => {
    const auto = autoClassify(derivatives, allPositions);
    setStrategies(auto);
    setSelectedIds(new Set());
  };

  const handleSave = async () => {
    const configs: UpsertConfigParams[] = [];

    for (const strategy of strategies) {
      const underlying = strategy.positions.find(p => p.asset_type === 'derivative')?.underlying
        || strategy.positions[0]?.description || 'Unknown';
      const stockPos = strategy.positions.find(p => p.asset_type === 'stock' || p.asset_type === 'etf');

      configs.push({
        underlying,
        strategy_type: strategy.strategyType,
        position_signatures: buildSignatures(strategy.positions),
        is_synthetic: strategy.isSynthetic,
        linked_stock_id: stockPos?.id || null,
      });
    }

    // Keep existing configs for underlyings not in this wizard (when filterUnderlyings is set)
    if (filterUnderlyings) {
      for (const existing of existingConfigs) {
        if (!configs.some(c => c.underlying === existing.underlying)) {
          configs.push({
            underlying: existing.underlying,
            strategy_type: existing.strategy_type,
            position_signatures: existing.position_signatures,
            is_synthetic: existing.is_synthetic,
            linked_stock_id: existing.linked_stock_id,
          });
        }
      }
    }

    await onSave(configs);
    onOpenChange(false);
  };

  if (allAvailable.length === 0) return null;

  const strategyLabel = (type: string) => STRATEGY_OPTIONS.find(o => o.value === type)?.label || type;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5" />
            Configurazione Strategie Derivati
          </DialogTitle>
          <DialogDescription>
            Seleziona le posizioni dal pool e crea strategie. Usa "Auto-classifica" per un suggerimento iniziale.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 pb-2 border-b">
          <Button variant="outline" size="sm" onClick={handleAutoClassify}>
            <Wand2 className="w-4 h-4 mr-2" />
            Auto-classifica
          </Button>
          <span className="text-xs text-muted-foreground">
            {pool.length} posizioni non assegnate • {strategies.length} strategie create
          </span>
        </div>

        <ScrollArea className="flex-1 pr-2">
          <div className="space-y-4 pb-4">
            {/* === POOL === */}
            <Card className="border-dashed">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-sm font-medium flex items-center justify-between">
                  <span>Pool posizioni disponibili ({pool.length})</span>
                  {selectedIds.size > 0 && (
                    <Button size="sm" variant="default" onClick={createStrategyFromSelected}>
                      <Plus className="w-3 h-3 mr-1" />
                      Crea strategia ({selectedIds.size} sel.)
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                {pool.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">Tutte le posizioni sono state assegnate.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {pool.map(p => (
                      <label
                        key={p.id}
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs cursor-pointer transition-colors ${
                          selectedIds.has(p.id)
                            ? 'bg-primary/10 border-primary'
                            : 'hover:bg-muted/50'
                        } ${positionBadgeClass(p)}`}
                      >
                        <Checkbox
                          checked={selectedIds.has(p.id)}
                          onCheckedChange={() => toggleSelected(p.id)}
                          className="w-3.5 h-3.5"
                        />
                        {positionLabel(p)}
                      </label>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* === STRATEGY GROUPS === */}
            {strategies.map(strategy => {
              const showSynthetic = strategy.strategyType === 'covered_call' || strategy.strategyType === 'derisking_covered_call';
              return (
                <Card key={strategy.id} className="border-border">
                  <CardHeader className="pb-2 pt-3 px-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Select
                          value={strategy.strategyType}
                          onValueChange={(v) => updateStrategyType(strategy.id, v)}
                        >
                          <SelectTrigger className="w-52 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STRATEGY_OPTIONS.map(opt => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {strategy.suggestedType && strategy.suggestedType !== strategy.strategyType && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            Suggerito: {strategyLabel(strategy.suggestedType)}
                          </Badge>
                        )}

                        {strategy.suggestedType === strategy.strategyType && (
                          <Badge variant="secondary" className="text-[10px]">
                            ✓ Auto-detected
                          </Badge>
                        )}

                        {showSynthetic && (
                          <div className="flex items-center gap-1.5">
                            <Checkbox
                              id={`syn-${strategy.id}`}
                              checked={strategy.isSynthetic}
                              onCheckedChange={() => toggleSynthetic(strategy.id)}
                              className="w-3.5 h-3.5"
                            />
                            <Label htmlFor={`syn-${strategy.id}`} className="text-[10px] text-muted-foreground cursor-pointer flex items-center gap-1">
                              <Zap className="w-3 h-3" /> Sintetica
                            </Label>
                          </div>
                        )}
                      </div>

                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => deleteStrategy(strategy.id)}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-3">
                    <div className="flex flex-wrap gap-1.5">
                      {strategy.positions.map(p => (
                        <Badge
                          key={p.id}
                          variant="outline"
                          className={`text-xs pr-1 ${positionBadgeClass(p)}`}
                        >
                          {positionLabel(p)}
                          <button
                            className="ml-1 hover:text-destructive"
                            onClick={() => removeFromStrategy(strategy.id, p.id)}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="pt-4 border-t">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Annulla
          </Button>
          <Button onClick={handleSave} disabled={isSaving || strategies.length === 0}>
            <Check className="w-4 h-4 mr-2" />
            {isSaving ? 'Salvataggio...' : 'Salva Configurazione'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
