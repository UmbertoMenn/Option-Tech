import { useState, useMemo, useCallback } from 'react';
import { Position } from '@/types/portfolio';
import { normalizeForMatching, findUnderlyingStock, categorizeDerivatives } from '@/lib/derivativeStrategies';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Settings2, Check, Zap, Plus, X, Wand2, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
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
    // Check if this is a virtual slot (id contains __slot_)
    const slotMatch = p.id.match(/__slot_(\d+)$/);
    if (slotMatch) {
      const originalId = p.id.replace(/__slot_\d+$/, '');
      // We don't have access to total slots here, so just show slot number
      const slotNum = parseInt(slotMatch[1]) + 1;
      return `${p.description} (${p.quantity} azioni) [slot ${slotNum}]`;
    }
    return `${p.description} (${p.quantity} azioni)`;
  }
  const prefix = p.ticker || p.underlying || p.description || '';
  const side = p.quantity < 0 ? 'V' : 'A';
  const type = p.option_type?.toUpperCase() || '?';
  const strike = p.strike_price || '?';
  const expiry = formatExpiryMMY(p.expiry_date);
  const qty = Math.abs(p.quantity) > 1 ? ` ×${Math.abs(p.quantity)}` : '';
  return `${prefix} ${side} ${type} ${strike} ${expiry}${qty}`;
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

  // Check for put spread: bought put strike < sold put strike → spread, not protection
  const hasPutSpread = soldPuts.length > 0 && boughtPuts.length > 0 && (() => {
    const maxSoldPutStrike = Math.max(...soldPuts.map(p => p.strike_price || 0));
    const minBoughtPutStrike = Math.min(...boughtPuts.map(p => p.strike_price || 0));
    return minBoughtPutStrike < maxSoldPutStrike;
  })();

  // Pure put spread (no calls) → other
  if (hasPutSpread && soldCalls.length === 0 && boughtCalls.length === 0) return 'other';

  if (soldCalls.length > 0 && (hasStock || soldPuts.some(p => Math.abs(p.strike_price || 0) > 0))) {
    // Only classify as derisking if bought put is protective (not a spread)
    if (boughtPuts.length > 0 && !hasPutSpread) return 'derisking_covered_call';
    if (hasStock) return 'covered_call';
  }

  if (soldPuts.length > 0 && !hasStock && soldCalls.length === 0 && boughtCalls.length === 0) return 'naked_put';
  if (boughtCalls.length > 0 && soldCalls.length === 0 && soldPuts.length === 0) return 'leap_call';

  return 'other';
}

/** 
 * Auto-classify using the SAME categorizeDerivatives logic used in the rest of the app.
 * Called with zero overrides and zero configs to get the "default" classification.
 */
function autoClassify(derivatives: Position[], allPositions: Position[]): WizardStrategy[] {
  const result = categorizeDerivatives(derivatives, allPositions, [], []);
  const strategies: WizardStrategy[] = [];
  let idCounter = 0;
  const consumedIds = new Set<string>();

  const addUnique = (positions: Position[]): Position[] => {
    const unique = Array.from(new Map(positions.map(p => [p.id, p])).values());
    return unique.filter(p => !consumedIds.has(p.id));
  };

  const consume = (positions: Position[]) => {
    positions.forEach(p => consumedIds.add(p.id));
  };

  const make = (positions: Position[], type: string, synthetic = false): WizardStrategy => ({
    id: `auto-${idCounter++}`,
    positions,
    strategyType: type,
    isSynthetic: synthetic,
    suggestedType: type,
  });

  // --- Covered Calls: group by underlying ---
  const ccByUnderlying = new Map<string, { positions: Position[], isSynthetic: boolean }>();
  for (const cc of result.coveredCalls) {
    const key = normalizeForMatching(cc.option.underlying || cc.option.description || '');
    if (!ccByUnderlying.has(key)) ccByUnderlying.set(key, { positions: [], isSynthetic: false });
    const entry = ccByUnderlying.get(key)!;
    entry.positions.push(cc.option);
    if (cc.underlying) entry.positions.push(cc.underlying);
    if (cc.syntheticPut) entry.positions.push(cc.syntheticPut);
    if (cc.isSynthetic) entry.isSynthetic = true;
  }
  for (const [, { positions, isSynthetic }] of ccByUnderlying) {
    const unique = addUnique(positions);
    if (unique.length > 0) {
      consume(unique);
      strategies.push(make(unique, 'covered_call', isSynthetic));
    }
  }

  // --- De-Risking Covered Calls: group by underlying ---
  const drccByUnderlying = new Map<string, { positions: Position[], isSynthetic: boolean }>();
  for (const drcc of result.deRiskingCoveredCalls) {
    const key = normalizeForMatching(drcc.coveredCall.option.underlying || drcc.coveredCall.option.description || '');
    if (!drccByUnderlying.has(key)) drccByUnderlying.set(key, { positions: [], isSynthetic: false });
    const entry = drccByUnderlying.get(key)!;
    entry.positions.push(drcc.coveredCall.option, drcc.protectionPut);
    if (drcc.coveredCall.underlying) entry.positions.push(drcc.coveredCall.underlying);
    if (drcc.syntheticPut) entry.positions.push(drcc.syntheticPut);
    if (drcc.isSynthetic) entry.isSynthetic = true;
  }
  for (const [, { positions, isSynthetic }] of drccByUnderlying) {
    const unique = addUnique(positions);
    if (unique.length > 0) {
      consume(unique);
      strategies.push(make(unique, 'derisking_covered_call', isSynthetic));
    }
  }

  // --- Iron Condors: solo gambe opzioni ---
  for (const ic of result.ironCondors) {
    const legs = addUnique([ic.soldCall, ic.boughtCall, ic.soldPut, ic.boughtPut]);
    if (legs.length > 0) {
      consume(legs);
      strategies.push(make(legs, 'iron_condor'));
    }
  }

  // --- Double Diagonals: solo gambe opzioni ---
  for (const dd of result.doubleDiagonals) {
    const legs = addUnique([dd.soldCall, dd.boughtCall, dd.soldPut, dd.boughtPut]);
    if (legs.length > 0) {
      consume(legs);
      strategies.push(make(legs, 'double_diagonal'));
    }
  }

  // --- Naked Puts: group by underlying ---
  const npByUnderlying = new Map<string, Position[]>();
  for (const np of result.nakedPuts) {
    const key = normalizeForMatching(np.option.underlying || np.option.description || '');
    if (!npByUnderlying.has(key)) npByUnderlying.set(key, []);
    npByUnderlying.get(key)!.push(np.option);
  }
  for (const [, positions] of npByUnderlying) {
    const unique = addUnique(positions);
    if (unique.length > 0) {
      consume(unique);
      strategies.push(make(unique, 'naked_put'));
    }
  }

  // --- Leap Calls: group by underlying ---
  const lcByUnderlying = new Map<string, Position[]>();
  for (const lc of result.leapCalls) {
    const key = normalizeForMatching(lc.option.underlying || lc.option.description || '');
    if (!lcByUnderlying.has(key)) lcByUnderlying.set(key, []);
    lcByUnderlying.get(key)!.push(lc.option);
  }
  for (const [, positions] of lcByUnderlying) {
    const unique = addUnique(positions);
    if (unique.length > 0) {
      consume(unique);
      strategies.push(make(unique, 'leap_call'));
    }
  }

  // --- Long Puts: solo opzione, niente azione ---
  for (const lp of result.longPuts) {
    const legs = addUnique([lp.option]);
    if (legs.length > 0) {
      consume(legs);
      strategies.push(make(legs, 'other'));
    }
  }

  // --- Other Strategies: solo gambe opzioni, niente azione ---
  for (const group of result.groupedOtherStrategies) {
    const options = group.options.map(o => o.option);
    const unique = addUnique(options);
    if (unique.length > 0) {
      consume(unique);
      strategies.push(make(unique, 'other'));
    }
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
    
    // Split stocks into 100-share virtual slots
    const virtualStocks: Position[] = [];
    for (const stock of stocks) {
      if (stock.quantity >= 200) {
        const slots = Math.floor(stock.quantity / 100);
        for (let i = 0; i < slots; i++) {
          virtualStocks.push({
            ...stock,
            id: `${stock.id}__slot_${i}`,
            quantity: 100,
          });
        }
        const remainder = stock.quantity % 100;
        if (remainder > 0) {
          virtualStocks.push({
            ...stock,
            id: `${stock.id}__slot_${slots}`,
            quantity: remainder,
          });
        }
      } else {
        virtualStocks.push(stock);
      }
    }
    
    return [...derivs, ...virtualStocks];
  }, [derivatives, allPositions, filterUnderlyings]);

  const [strategies, setStrategies] = useState<WizardStrategy[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

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

  const filteredPool = useMemo(() => {
    if (!searchQuery.trim()) return pool;
    const q = searchQuery.toLowerCase();
    return pool.filter(p =>
      (p.description || '').toLowerCase().includes(q) ||
      (p.ticker || '').toLowerCase().includes(q) ||
      (p.underlying || '').toLowerCase().includes(q)
    );
  }, [pool, searchQuery]);

  // Reset state when dialog opens
  const handleOpenChange = useCallback((isOpen: boolean) => {
    if (isOpen) {
      setStrategies([]);
      setSelectedIds(new Set());
      setSearchQuery('');
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
      // Strip virtual slot suffix (__slot_N) to get the real stock ID
      const realStockId = stockPos?.id?.replace(/__slot_\d+$/, '') || null;

      configs.push({
        underlying,
        strategy_type: strategy.strategyType,
        position_signatures: buildSignatures(strategy.positions),
        is_synthetic: strategy.isSynthetic,
        linked_stock_id: realStockId,
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

        <div className="flex-1 min-h-0 overflow-y-auto pr-2">
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
                  <div className="space-y-1">
                    <div className="relative mb-2">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Cerca posizione..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-8 text-xs pl-8"
                      />
                    </div>
                    {(() => {
                      const stockItems = filteredPool.filter(p => p.asset_type === 'stock');
                      const derivItems = filteredPool.filter(p => p.asset_type === 'derivative');
                      const etfItems = filteredPool.filter(p => p.asset_type === 'etf');

                      // Group stocks by base name for sub-grouping
                      const stockGroups = new Map<string, Position[]>();
                      for (const s of stockItems) {
                        const baseName = s.description || s.ticker || 'Unknown';
                        if (!stockGroups.has(baseName)) stockGroups.set(baseName, []);
                        stockGroups.get(baseName)!.push(s);
                      }

                      const renderPositionChip = (p: Position) => (
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
                      );

                      return ([
                        { label: 'AZIONI', items: stockItems, isStock: true },
                        { label: 'DERIVATI', items: derivItems, isStock: false },
                        { label: 'ETF', items: etfItems, isStock: false },
                      ] as const).filter(s => s.items.length > 0).map(section => (
                        <Collapsible key={section.label} defaultOpen>
                          <CollapsibleTrigger className="flex items-center gap-1.5 w-full py-1.5 text-[11px] text-muted-foreground font-medium uppercase tracking-wide hover:text-foreground transition-colors group">
                            <ChevronDown className="w-3.5 h-3.5 transition-transform group-data-[state=closed]:-rotate-90" />
                            {section.label} ({section.items.length})
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            {section.isStock ? (
                              <div className="space-y-1.5 pb-2">
                                {Array.from(stockGroups.entries()).map(([name, slots]) => (
                                  <div key={name}>
                                    {stockGroups.size > 1 && slots.length > 1 && (
                                      <span className="text-[10px] text-muted-foreground font-medium ml-1">
                                        {name} ({slots.length} slot)
                                      </span>
                                    )}
                                    <div className="flex flex-wrap gap-1.5">
                                      {slots.map(renderPositionChip)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-1.5 pb-2">
                                {section.items.map(renderPositionChip)}
                              </div>
                            )}
                          </CollapsibleContent>
                        </Collapsible>
                      ));
                    })()}
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
                        {(() => {
                          const firstDeriv = strategy.positions.find(p => p.asset_type === 'derivative');
                          const underlyingName = firstDeriv?.underlying || firstDeriv?.description || strategy.positions[0]?.description || '';
                          return underlyingName ? (
                            <span className="text-xs font-bold uppercase truncate max-w-[120px]">{underlyingName}</span>
                          ) : null;
                        })()}
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
        </div>

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
