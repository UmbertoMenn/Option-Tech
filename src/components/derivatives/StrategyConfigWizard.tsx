import { useState, useMemo, useCallback } from 'react';
import { Position } from '@/types/portfolio';
import { normalizeForMatching, findUnderlyingStock, categorizeDerivatives, getCanonicalKey } from '@/lib/derivativeStrategies';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Settings2, Check, Zap, Plus, X, Wand2, ChevronDown, Search, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { UpsertConfigParams, PositionSignature, StrategyConfiguration } from '@/hooks/useStrategyConfigurations';

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
  { value: 'put_spread', label: 'Put Spread' },
  { value: 'diagonal_put_spread', label: 'Diagonal Put Spread' },
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
    const slotMatch = p.id.match(/__slot_(\d+)$/);
    if (slotMatch) {
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

function detectStrategyType(positions: Position[]): string {
  const options = positions.filter(p => p.asset_type === 'derivative');
  const stocks = positions.filter(p => p.asset_type === 'stock' || p.asset_type === 'etf');

  const soldCalls = options.filter(o => o.option_type === 'call' && o.quantity < 0);
  const boughtCalls = options.filter(o => o.option_type === 'call' && o.quantity > 0);
  const soldPuts = options.filter(o => o.option_type === 'put' && o.quantity < 0);
  const boughtPuts = options.filter(o => o.option_type === 'put' && o.quantity > 0);
  const hasStock = stocks.some(s => s.quantity > 0);

  if (soldCalls.length >= 1 && boughtCalls.length >= 1 && soldPuts.length >= 1 && boughtPuts.length >= 1) {
    const expiries = new Set(options.map(o => o.expiry_date));
    if (expiries.size === 1) return 'iron_condor';
    if (expiries.size >= 2) return 'double_diagonal';
  }

  const hasPutSpread = soldPuts.length > 0 && boughtPuts.length > 0 && (() => {
    const maxSoldPutStrike = Math.max(...soldPuts.map(p => p.strike_price || 0));
    const minBoughtPutStrike = Math.min(...boughtPuts.map(p => p.strike_price || 0));
    return minBoughtPutStrike < maxSoldPutStrike;
  })();

  if (hasPutSpread && soldCalls.length === 0 && boughtCalls.length === 0) {
    const allPutExpiries = new Set([...soldPuts, ...boughtPuts].map(p => p.expiry_date || ''));
    return allPutExpiries.size <= 1 ? 'put_spread' : 'diagonal_put_spread';
  }

  if (soldCalls.length > 0 && (hasStock || soldPuts.some(p => Math.abs(p.strike_price || 0) > 0))) {
    if (boughtPuts.length > 0 && !hasPutSpread) return 'derisking_covered_call';
    if (hasStock) return 'covered_call';
  }

  if (soldPuts.length > 0 && !hasStock && soldCalls.length === 0 && boughtCalls.length === 0) return 'naked_put';
  if (boughtCalls.length > 0 && soldCalls.length === 0 && soldPuts.length === 0) return 'leap_call';

  return 'other';
}

/**
 * Get the normalized underlying key for any position (stock, derivative, etf).
 * For derivatives: use `underlying` field.
 * For stocks: normalize description.
 * Uses canonical aliases (GOOGLE → ALPHABET) for consistency.
 */
function getUnderlyingKey(p: Position, allDerivatives: Position[]): string {
  if (p.asset_type === 'derivative') {
    const raw = p.underlying || p.description || '';
    return getCanonicalKey(raw) || normalizeForMatching(raw);
  }
  // Stock or ETF: try to find matching derivative underlying via findUnderlyingStock logic
  const stockText = `${p.description ?? ''} ${p.ticker ?? ''}`;
  const canonical = getCanonicalKey(stockText);
  if (canonical) return canonical;

  // Try to match against derivative underlyings
  const stockNorm = normalizeForMatching(stockText);
  for (const d of allDerivatives) {
    const dUnderlying = d.underlying || d.description || '';
    const dNorm = normalizeForMatching(dUnderlying);
    const dCanonical = getCanonicalKey(dUnderlying);
    if (dCanonical) {
      // Check if stock matches this canonical
      if (stockNorm.includes(dNorm) || dNorm.includes(stockNorm)) {
        return dCanonical;
      }
    }
    if (stockNorm.includes(dNorm) || dNorm.includes(stockNorm)) {
      return dNorm;
    }
  }
  return stockNorm;
}

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

  // Covered Calls
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
    if (unique.length > 0) { consume(unique); strategies.push(make(unique, 'covered_call', isSynthetic)); }
  }

  // De-Risking Covered Calls
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
    if (unique.length > 0) { consume(unique); strategies.push(make(unique, 'derisking_covered_call', isSynthetic)); }
  }

  // Iron Condors
  for (const ic of result.ironCondors) {
    const legs = addUnique([ic.soldCall, ic.boughtCall, ic.soldPut, ic.boughtPut]);
    if (legs.length > 0) { consume(legs); strategies.push(make(legs, 'iron_condor')); }
  }

  // Double Diagonals
  for (const dd of result.doubleDiagonals) {
    const legs = addUnique([dd.soldCall, dd.boughtCall, dd.soldPut, dd.boughtPut]);
    if (legs.length > 0) { consume(legs); strategies.push(make(legs, 'double_diagonal')); }
  }

  // Naked Puts
  const npByUnderlying = new Map<string, Position[]>();
  for (const np of result.nakedPuts) {
    const key = normalizeForMatching(np.option.underlying || np.option.description || '');
    if (!npByUnderlying.has(key)) npByUnderlying.set(key, []);
    npByUnderlying.get(key)!.push(np.option);
  }
  for (const [, positions] of npByUnderlying) {
    const unique = addUnique(positions);
    if (unique.length > 0) { consume(unique); strategies.push(make(unique, 'naked_put')); }
  }

  // Leap Calls
  const lcByUnderlying = new Map<string, Position[]>();
  for (const lc of result.leapCalls) {
    const key = normalizeForMatching(lc.option.underlying || lc.option.description || '');
    if (!lcByUnderlying.has(key)) lcByUnderlying.set(key, []);
    lcByUnderlying.get(key)!.push(lc.option);
  }
  for (const [, positions] of lcByUnderlying) {
    const unique = addUnique(positions);
    if (unique.length > 0) { consume(unique); strategies.push(make(unique, 'leap_call')); }
  }

  // Long Puts → other
  for (const lp of result.longPuts) {
    const legs = addUnique([lp.option]);
    if (legs.length > 0) { consume(legs); strategies.push(make(legs, 'other')); }
  }

  // Other Strategies
  for (const group of result.groupedOtherStrategies) {
    const options = group.options.map(o => o.option);
    const unique = addUnique(options);
    if (unique.length > 0) { consume(unique); strategies.push(make(unique, 'other')); }
  }

  return strategies;
}

let nextId = 0;
function genId() { return `ws-${Date.now()}-${nextId++}`; }

/** A group of positions sharing the same underlying */
interface UnderlyingGroup {
  key: string;        // normalized key
  displayName: string; // human-readable name
  positions: Position[];
}

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
  // Build all available positions (derivatives + split stocks)
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
          virtualStocks.push({ ...stock, id: `${stock.id}__slot_${i}`, quantity: 100 });
        }
        const remainder = stock.quantity % 100;
        if (remainder > 0) {
          virtualStocks.push({ ...stock, id: `${stock.id}__slot_${slots}`, quantity: remainder });
        }
      } else {
        virtualStocks.push(stock);
      }
    }
    
    return [...derivs, ...virtualStocks];
  }, [derivatives, allPositions, filterUnderlyings]);

  // Group all positions by normalized underlying
  const underlyingGroups = useMemo((): UnderlyingGroup[] => {
    const groupMap = new Map<string, { displayName: string; positions: Position[] }>();
    const derivsOnly = allAvailable.filter(p => p.asset_type === 'derivative');

    for (const p of allAvailable) {
      const key = getUnderlyingKey(p, derivsOnly);
      if (!groupMap.has(key)) {
        // Pick a human-readable display name
        let display = key;
        if (p.asset_type === 'derivative' && p.underlying) {
          display = p.underlying;
        } else if (p.asset_type === 'stock' || p.asset_type === 'etf') {
          display = p.description.replace(/^AZ\.\s*/i, '').trim();
        }
        groupMap.set(key, { displayName: display, positions: [] });
      }
      groupMap.get(key)!.positions.push(p);
    }

    // Sort groups alphabetically by display name
    return Array.from(groupMap.entries())
      .map(([key, { displayName, positions }]) => ({ key, displayName, positions }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [allAvailable]);

  const [strategies, setStrategies] = useState<WizardStrategy[]>([]);
  const [selectedIdsByGroup, setSelectedIdsByGroup] = useState<Map<string, Set<string>>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');

  // Assigned position ids across all strategies
  const assignedIds = useMemo(() => {
    const ids = new Set<string>();
    strategies.forEach(s => s.positions.forEach(p => ids.add(p.id)));
    return ids;
  }, [strategies]);

  const handleOpenChange = useCallback((isOpen: boolean) => {
    if (isOpen) {
      setStrategies([]);
      setSelectedIdsByGroup(new Map());
      setSearchQuery('');
    }
    onOpenChange(isOpen);
  }, [onOpenChange]);

  const toggleSelected = (groupKey: string, posId: string) => {
    setSelectedIdsByGroup(prev => {
      const next = new Map(prev);
      const groupSet = new Set(next.get(groupKey) || []);
      if (groupSet.has(posId)) groupSet.delete(posId); else groupSet.add(posId);
      next.set(groupKey, groupSet);
      return next;
    });
  };

  const createStrategyFromSelected = (groupKey: string, groupPositions: Position[]) => {
    const selectedSet = selectedIdsByGroup.get(groupKey);
    if (!selectedSet || selectedSet.size === 0) return;

    const available = groupPositions.filter(p => !assignedIds.has(p.id));
    const selected = available.filter(p => selectedSet.has(p.id));
    if (selected.length === 0) return;

    const suggested = detectStrategyType(selected);
    setStrategies(prev => [...prev, {
      id: genId(),
      positions: selected,
      strategyType: suggested,
      isSynthetic: false,
      suggestedType: suggested,
    }]);
    // Clear selection for this group
    setSelectedIdsByGroup(prev => {
      const next = new Map(prev);
      next.delete(groupKey);
      return next;
    });
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
    setSelectedIdsByGroup(new Map());
  };

  const handleSave = async () => {
    const configs: UpsertConfigParams[] = [];

    for (const strategy of strategies) {
      const underlying = strategy.positions.find(p => p.asset_type === 'derivative')?.underlying
        || strategy.positions[0]?.description || 'Unknown';
      const stockPos = strategy.positions.find(p => p.asset_type === 'stock' || p.asset_type === 'etf');
      const realStockId = stockPos?.id?.replace(/__slot_\d+$/, '') || null;

      configs.push({
        underlying,
        strategy_type: strategy.strategyType,
        position_signatures: buildSignatures(strategy.positions),
        is_synthetic: strategy.isSynthetic,
        linked_stock_id: realStockId,
      });
    }

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

  const strategyLabel = (type: string) => STRATEGY_OPTIONS.find(o => o.value === type)?.label || type;

  // Filter groups by search
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return underlyingGroups;
    const q = searchQuery.toLowerCase();
    return underlyingGroups.filter(g =>
      g.displayName.toLowerCase().includes(q) ||
      g.key.toLowerCase().includes(q) ||
      g.positions.some(p =>
        (p.ticker || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q)
      )
    );
  }, [underlyingGroups, searchQuery]);

  // Get strategies for a specific underlying group
  const getStrategiesForGroup = (groupKey: string, groupPositions: Position[]) => {
    const groupPosIds = new Set(groupPositions.map(p => p.id));
    return strategies.filter(s => s.positions.some(p => groupPosIds.has(p.id)));
  };

  const totalStrategies = strategies.length;
  const totalUnassigned = allAvailable.filter(p => !assignedIds.has(p.id)).length;

  if (allAvailable.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5" />
            Configurazione Strategie Derivati
          </DialogTitle>
          <DialogDescription>
            Posizioni raggruppate per sottostante. Seleziona e crea strategie liberamente.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 pb-2 border-b">
          <Button variant="outline" size="sm" onClick={handleAutoClassify}>
            <Wand2 className="w-4 h-4 mr-2" />
            Auto-classifica
          </Button>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Cerca sottostante..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 text-xs pl-8"
            />
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {totalUnassigned} libere • {totalStrategies} strategie
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pr-2">
          <div className="space-y-3 pb-4 pt-2">
            {filteredGroups.map(group => {
              const availablePositions = group.positions.filter(p => !assignedIds.has(p.id));
              const groupStrategies = getStrategiesForGroup(group.key, group.positions);
              const selectedSet = selectedIdsByGroup.get(group.key) || new Set<string>();
              // Only count selected items that are still available
              const selectedCount = availablePositions.filter(p => selectedSet.has(p.id)).length;

              return (
                <Collapsible key={group.key} defaultOpen={groupStrategies.length > 0 || availablePositions.length > 0}>
                  <Card className="border-border">
                    <CollapsibleTrigger className="w-full">
                      <CardHeader className="pb-2 pt-3 px-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
                            <span className="text-sm font-bold uppercase">{group.displayName}</span>
                            <Badge variant="outline" className="text-[10px]">
                              {group.positions.length} pos.
                            </Badge>
                            {groupStrategies.length > 0 && (
                              <Badge variant="secondary" className="text-[10px]">
                                {groupStrategies.length} {groupStrategies.length === 1 ? 'strategia' : 'strategie'}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent className="px-4 pb-3 space-y-3">
                        {/* Available positions */}
                        {availablePositions.length > 0 && (
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                                Posizioni disponibili ({availablePositions.length})
                              </span>
                              {selectedCount > 0 && (
                                <Button
                                  size="sm"
                                  variant="default"
                                  className="h-6 text-[11px] px-2"
                                  onClick={() => createStrategyFromSelected(group.key, group.positions)}
                                >
                                  <Plus className="w-3 h-3 mr-1" />
                                  Crea strategia ({selectedCount})
                                </Button>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {availablePositions.map(p => (
                                <label
                                  key={p.id}
                                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs cursor-pointer transition-colors ${
                                    selectedSet.has(p.id)
                                      ? 'bg-primary/10 border-primary'
                                      : 'hover:bg-muted/50'
                                  } ${positionBadgeClass(p)}`}
                                >
                                  <Checkbox
                                    checked={selectedSet.has(p.id)}
                                    onCheckedChange={() => toggleSelected(group.key, p.id)}
                                    className="w-3.5 h-3.5"
                                  />
                                  {positionLabel(p)}
                                </label>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Strategies configured for this group */}
                        {groupStrategies.map(strategy => {
                          const showSynthetic = strategy.strategyType === 'covered_call' || strategy.strategyType === 'derisking_covered_call';
                          return (
                            <div key={strategy.id} className="rounded-md border border-dashed border-border p-2.5 space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Select
                                    value={strategy.strategyType}
                                    onValueChange={(v) => updateStrategyType(strategy.id, v)}
                                  >
                                    <SelectTrigger className="w-48 h-7 text-xs">
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
                                      ✓ Auto
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
                                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                </Button>
                              </div>
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
                            </div>
                          );
                        })}

                        {availablePositions.length === 0 && groupStrategies.length === 0 && (
                          <p className="text-xs text-muted-foreground py-1">Nessuna posizione disponibile.</p>
                        )}
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
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
