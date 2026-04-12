import { useState, useMemo, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertTriangle, Check, X, Plus, Zap, Trash2, ChevronDown, Loader2, Scissors, Merge } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { ReconciliationItem, LegStatus } from '@/lib/strategyReconciliation';
import { UpsertConfigParams, PositionSignature, StrategyConfiguration } from '@/hooks/useStrategyConfigurations';
import { Position } from '@/types/portfolio';
import { normalizeForMatching, getCanonicalKey } from '@/lib/derivativeStrategies';

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

function formatExpiryMMY(date: string | null | undefined): string {
  if (!date) return '-';
  const months = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
  const d = new Date(date);
  return `${months[d.getMonth()]}/${d.getFullYear().toString().slice(-2)}`;
}

function positionLabel(p: Position): string {
  if (p.asset_type === 'stock' || p.asset_type === 'etf') {
    const slotMatch = p.id.match(/__slot_(\d+)$/);
    if (slotMatch) {
      const letter = String.fromCharCode(65 + parseInt(slotMatch[1]));
      return `${p.description} (${p.quantity} azioni) (${letter})`;
    }
    return `${p.description} (${p.quantity} azioni)`;
  }
  const prefix = p.ticker || p.underlying || p.description || '';
  const side = p.quantity < 0 ? 'V' : 'A';
  const type = p.option_type?.toUpperCase() || '?';
  const strike = p.strike_price || '?';
  const expiry = formatExpiryMMY(p.expiry_date);
  const optSlotMatch = p.id.match(/__opt_slot_(\d+)$/);
  if (optSlotMatch) {
    const letter = String.fromCharCode(65 + parseInt(optSlotMatch[1]));
    return `${prefix} ${side} ${type} ${strike} ${expiry} (${letter})`;
  }
  const qty = Math.abs(p.quantity) > 1 ? ` ×${Math.abs(p.quantity)}` : '';
  return `${prefix} ${side} ${type} ${strike} ${expiry}${qty}`;
}

function positionBadgeClass(p: Position): string {
  if (p.asset_type === 'stock' || p.asset_type === 'etf') return 'border-blue-500/50 text-blue-500';
  return p.quantity < 0 ? 'border-green-500/50 text-green-500' : 'border-red-500/50 text-red-500';
}

function sigLabel(sig: PositionSignature): string {
  const side = sig.quantity_sign < 0 ? 'V' : 'A';
  const type = (sig.option_type || '?').toUpperCase();
  const strike = sig.strike || '?';
  const expiry = formatExpiryMMY(sig.expiry);
  return `${side} ${type} ${strike} ${expiry}`;
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

function buildSignatures(positions: Position[]): PositionSignature[] {
  const sigMap = new Map<string, PositionSignature & { totalQty: number }>();
  for (const o of positions) {
    if (o.asset_type !== 'derivative') continue;
    const baseId = o.id.replace(/__opt_slot_\d+$/, '');
    const sigKey = `${baseId}::${(o.option_type || '').toLowerCase()}::${o.strike_price || 0}::${o.expiry_date || ''}::${o.quantity >= 0 ? 1 : -1}`;
    if (sigMap.has(sigKey)) {
      const isSlot = /__opt_slot_\d+$/.test(o.id);
      sigMap.get(sigKey)!.totalQty += isSlot ? 1 : Math.abs(o.quantity);
    } else {
      const isSlot = /__opt_slot_\d+$/.test(o.id);
      sigMap.set(sigKey, {
        option_type: o.option_type || 'unknown',
        strike: o.strike_price || 0,
        expiry: o.expiry_date || '',
        quantity_sign: o.quantity >= 0 ? 1 : -1,
        quantity_abs: 1,
        totalQty: isSlot ? 1 : Math.abs(o.quantity),
      });
    }
  }
  return Array.from(sigMap.values()).map(({ totalQty, ...sig }) => ({
    ...sig,
    quantity_abs: totalQty,
  }));
}

function normalizeUnderlying(text: string): string {
  return getCanonicalKey(text) || normalizeForMatching(text);
}

const MATCHING_STOPWORDS = new Set([
  'INC', 'LTD', 'CORP', 'GROUP', 'HOLDING', 'HOLDINGS', 'PLC', 'CO', 'NV',
  'SA', 'AG', 'SE', 'AB', 'CLASS', 'CL', 'ADR', 'SHARES', 'COMPANY', 'THE',
  'CORPORATION', 'INTERNATIONAL', 'ENTERPRISES', 'TECHNOLOGIES', 'TECHNOLOGY',
]);

function getSignificantTokens(text: string): string[] {
  return text.toUpperCase()
    .replace(/^AZ\.\s*/i, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !MATCHING_STOPWORDS.has(t));
}

function hasTokenOverlap(a: string, b: string): boolean {
  const tokensA = getSignificantTokens(a);
  const tokensB = getSignificantTokens(b);
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  const [shorter, longer] = tokensA.length <= tokensB.length
    ? [tokensA, tokensB] : [tokensB, tokensA];
  const matchCount = shorter.filter(t => longer.includes(t)).length;
  if (shorter.length >= 2) return matchCount >= 2;
  return matchCount === 1 && shorter[0].length >= 4;
}

function getUnderlyingKeyForStock(pos: Position, allDerivatives: Position[]): string {
  const stockText = `${pos.description ?? ''} ${pos.ticker ?? ''}`;
  const canonical = getCanonicalKey(stockText);
  if (canonical) return canonical;

  const descOnly = pos.description ?? '';
  const descCanonical = getCanonicalKey(descOnly);
  if (descCanonical) return descCanonical;

  const stockNorm = normalizeForMatching(stockText);
  const descNorm = normalizeForMatching(descOnly);

  for (const d of allDerivatives) {
    const dUnderlying = d.underlying || d.description || '';
    const dNorm = normalizeForMatching(dUnderlying);
    const dCanonical = getCanonicalKey(dUnderlying);

    if (stockNorm.includes(dNorm) || dNorm.includes(stockNorm) ||
        descNorm.includes(dNorm) || dNorm.includes(descNorm)) {
      return dCanonical || dNorm;
    }

    if (hasTokenOverlap(descOnly, dUnderlying)) {
      return dCanonical || dNorm;
    }
  }
  return stockNorm;
}

interface WizardStrategy {
  id: string;
  positions: Position[];
  strategyType: string;
  isSynthetic: boolean;
  suggestedType: string;
  linkedStockId: string | null;
}

interface UnderlyingReconciliation {
  underlying: string;
  underlyingKey: string;
  missingLegs: LegStatus[];
  availablePositions: Position[]; // new + present-unassigned positions
  strategies: WizardStrategy[];
}

let nextId = 0;
function genId() { return `recon-${Date.now()}-${nextId++}`; }

interface StrategyReconciliationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ReconciliationItem[];
  allConfigs: StrategyConfiguration[];
  currentPositions: Position[];
  onSave: (configs: UpsertConfigParams[]) => Promise<void>;
  isSaving: boolean;
}

export function StrategyReconciliationDialog({
  open,
  onOpenChange,
  items,
  allConfigs,
  currentPositions,
  onSave,
  isSaving,
}: StrategyReconciliationDialogProps) {
  const [underlyingStates, setUnderlyingStates] = useState<Map<string, UnderlyingReconciliation>>(new Map());
  const [selectedByGroup, setSelectedByGroup] = useState<Map<string, Set<string>>>(new Map());
  const [initialized, setInitialized] = useState(false);
  const [splitPositionIds, setSplitPositionIds] = useState<Set<string>>(new Set());

  // Build initial state from reconciliation items
  const initStates = useCallback(() => {
    const states = new Map<string, UnderlyingReconciliation>();
    const affectedKeys = new Set<string>();

    // Group items by underlying key
    const itemsByKey = new Map<string, ReconciliationItem[]>();
    for (const item of items) {
      const key = normalizeUnderlying(item.underlying);
      affectedKeys.add(key);
      if (!itemsByKey.has(key)) itemsByKey.set(key, []);
      itemsByKey.get(key)!.push(item);
    }

    // Get all derivative positions grouped by underlying — keep as-is (no auto-splitting)
    const derivsByKey = new Map<string, Position[]>();
    for (const pos of currentPositions.filter(p => p.asset_type === 'derivative')) {
      const raw = pos.underlying || pos.description || '';
      const key = normalizeUnderlying(raw);
      if (!derivsByKey.has(key)) derivsByKey.set(key, []);
      derivsByKey.get(key)!.push(pos);
    }

    // Also get stock positions by underlying key for the pool
    const allDerivatives = currentPositions.filter(p => p.asset_type === 'derivative');
    const stocksByKey = new Map<string, Position[]>();
    for (const pos of currentPositions.filter(p => p.asset_type === 'stock' || p.asset_type === 'etf')) {
      const key = getUnderlyingKeyForStock(pos, allDerivatives);
      if (!stocksByKey.has(key)) stocksByKey.set(key, []);
      // Stocks enter pool with original quantity (no auto-splitting)
      stocksByKey.get(key)!.push(pos);
    }

    for (const [key, reconItems] of itemsByKey) {
      const missingLegs: LegStatus[] = [];
      const assignedPositionIds = new Set<string>();

      // Build strategies from existing configs (using present legs)
      const strategies: WizardStrategy[] = [];
      for (const item of reconItems) {
        const presentPositions: Position[] = [];
        for (const leg of item.legs) {
          if (leg.status === 'present' && leg.position) {
            presentPositions.push(leg.position);
            assignedPositionIds.add(leg.position.id);
          } else if (leg.status === 'missing') {
            missingLegs.push(leg);
          }
        }

        if (presentPositions.length > 0) {
          // Restore stock slots from linked_stock_slot_ids (preferred) or linked_stock_id (legacy)
          const slotIds = (item.config.linked_stock_slot_ids as string[]) || [];
          const linkedStockId = item.config.linked_stock_id;
          const stockPool = stocksByKey.get(key) || [];
          
          if (slotIds.length > 0) {
            // Restore all saved slots
            for (const slotId of slotIds) {
              const matchingSlot = stockPool.find(s => s.id === slotId && !assignedPositionIds.has(s.id));
              if (matchingSlot) {
                presentPositions.push(matchingSlot);
                assignedPositionIds.add(matchingSlot.id);
              } else {
                // Fallback: try matching by base ID prefix
                const baseId = slotId.replace(/__slot_\d+$/, '');
                const fallbackSlot = stockPool.find(s => s.id.startsWith(baseId) && !assignedPositionIds.has(s.id));
                if (fallbackSlot) {
                  presentPositions.push(fallbackSlot);
                  assignedPositionIds.add(fallbackSlot.id);
                }
              }
            }
          } else if (linkedStockId) {
            // Legacy: single linked_stock_id
            const matchingSlot = stockPool.find(s => s.id.startsWith(linkedStockId) && !assignedPositionIds.has(s.id));
            if (matchingSlot) {
              presentPositions.push(matchingSlot);
              assignedPositionIds.add(matchingSlot.id);
            }
          }

          const detected = detectStrategyType(presentPositions);
          strategies.push({
            id: genId(),
            positions: presentPositions,
            strategyType: item.strategyType,
            isSynthetic: item.config.is_synthetic,
            suggestedType: detected,
            linkedStockId: linkedStockId,
          });
        }
      }

      // Available positions: all derivatives + stocks for this underlying NOT assigned
      const allDerivs = derivsByKey.get(key) || [];
      const allStocks = stocksByKey.get(key) || [];
      const allPoolPositions = [...allDerivs, ...allStocks];
      const availablePositions = allPoolPositions.filter(p => !assignedPositionIds.has(p.id));

      states.set(key, {
        underlying: reconItems[0].underlying,
        underlyingKey: key,
        missingLegs,
        availablePositions,
        strategies,
      });
    }

    setUnderlyingStates(states);
    setSelectedByGroup(new Map());
    setInitialized(true);
  }, [items, currentPositions]);

  // Initialize via useEffect — never during render
  useEffect(() => {
    if (open && !initialized) {
      initStates();
    }
    if (!open && initialized) {
      setInitialized(false);
    }
  }, [open, initialized, initStates]);

  const handleOpenChange = useCallback((isOpen: boolean) => {
    onOpenChange(isOpen);
  }, [onOpenChange]);

  // Compute assigned IDs across all strategies
  const assignedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [, state] of underlyingStates) {
      state.strategies.forEach(s => s.positions.forEach(p => ids.add(p.id)));
    }
    return ids;
  }, [underlyingStates]);

  const toggleSelected = (groupKey: string, posId: string) => {
    setSelectedByGroup(prev => {
      const next = new Map(prev);
      const s = new Set(next.get(groupKey) || []);
      if (s.has(posId)) s.delete(posId); else s.add(posId);
      next.set(groupKey, s);
      return next;
    });
  };

  const createStrategyFromSelected = (groupKey: string) => {
    const state = underlyingStates.get(groupKey);
    if (!state) return;
    const selectedSet = selectedByGroup.get(groupKey);
    if (!selectedSet || selectedSet.size === 0) return;

    const selected = state.availablePositions.filter(p => selectedSet.has(p.id) && !assignedIds.has(p.id));
    if (selected.length === 0) return;

    const suggested = detectStrategyType(selected);
    const newStrategy: WizardStrategy = {
      id: genId(),
      positions: selected,
      strategyType: suggested,
      isSynthetic: false,
      suggestedType: suggested,
      linkedStockId: null,
    };

    setUnderlyingStates(prev => {
      const next = new Map(prev);
      const s = { ...next.get(groupKey)! };
      s.strategies = [...s.strategies, newStrategy];
      s.availablePositions = s.availablePositions.filter(p => !selectedSet.has(p.id));
      next.set(groupKey, s);
      return next;
    });
    setSelectedByGroup(prev => {
      const next = new Map(prev);
      next.delete(groupKey);
      return next;
    });
  };

  const removeFromStrategy = (groupKey: string, strategyId: string, positionId: string) => {
    setUnderlyingStates(prev => {
      const next = new Map(prev);
      const state = { ...next.get(groupKey)! };
      let removedPos: Position | undefined;

      state.strategies = state.strategies.map(s => {
        if (s.id !== strategyId) return s;
        removedPos = s.positions.find(p => p.id === positionId);
        const newPositions = s.positions.filter(p => p.id !== positionId);
        if (newPositions.length === 0) return null as any;
        return { ...s, positions: newPositions, suggestedType: detectStrategyType(newPositions) };
      }).filter(Boolean);

      if (removedPos) {
        state.availablePositions = [...state.availablePositions, removedPos];
      }
      next.set(groupKey, state);
      return next;
    });
  };

  const deleteStrategy = (groupKey: string, strategyId: string) => {
    setUnderlyingStates(prev => {
      const next = new Map(prev);
      const state = { ...next.get(groupKey)! };
      const deleted = state.strategies.find(s => s.id === strategyId);
      state.strategies = state.strategies.filter(s => s.id !== strategyId);
      if (deleted) {
        state.availablePositions = [...state.availablePositions, ...deleted.positions];
      }
      next.set(groupKey, state);
      return next;
    });
  };

  const updateStrategyType = (groupKey: string, strategyId: string, type: string) => {
    setUnderlyingStates(prev => {
      const next = new Map(prev);
      const state = { ...next.get(groupKey)! };
      state.strategies = state.strategies.map(s =>
        s.id === strategyId ? { ...s, strategyType: type } : s
      );
      next.set(groupKey, state);
      return next;
    });
  };

  const toggleSynthetic = (groupKey: string, strategyId: string) => {
    setUnderlyingStates(prev => {
      const next = new Map(prev);
      const state = { ...next.get(groupKey)! };
      state.strategies = state.strategies.map(s =>
        s.id === strategyId ? { ...s, isSynthetic: !s.isSynthetic } : s
      );
      next.set(groupKey, state);
      return next;
    });
  };

  const addToStrategy = (groupKey: string, strategyId: string) => {
    const state = underlyingStates.get(groupKey);
    if (!state) return;
    const selectedSet = selectedByGroup.get(groupKey);
    if (!selectedSet || selectedSet.size === 0) return;

    const toAdd = state.availablePositions.filter(
      p => selectedSet.has(p.id) && !assignedIds.has(p.id)
    );
    if (toAdd.length === 0) return;

    setUnderlyingStates(prev => {
      const next = new Map(prev);
      const s = { ...next.get(groupKey)! };
      s.strategies = s.strategies.map(st => {
        if (st.id !== strategyId) return st;
        const newPositions = [...st.positions, ...toAdd];
        return { ...st, positions: newPositions, suggestedType: detectStrategyType(newPositions) };
      });
      s.availablePositions = s.availablePositions.filter(p => !selectedSet.has(p.id));
      next.set(groupKey, s);
      return next;
    });
    setSelectedByGroup(prev => {
      const next = new Map(prev);
      next.delete(groupKey);
      return next;
    });
  };

  const handleSave = async () => {
    const configs: UpsertConfigParams[] = [];
    const affectedUnderlyings = new Set<string>();
    let sortIdx = 0;

    // Collect configs from reconciliation states
    for (const [, state] of underlyingStates) {
      affectedUnderlyings.add(state.underlying);
      for (const strategy of state.strategies) {
        if (strategy.positions.length === 0) continue;
        const underlying = strategy.positions.find(p => p.asset_type === 'derivative')?.underlying
          || state.underlying;
        const stockPositions = strategy.positions.filter(p => p.asset_type === 'stock' || p.asset_type === 'etf');
        // Persist ALL stock slot IDs (with __slot_N suffix)
        const stockSlotIds = stockPositions.map(s => s.id);
        const realStockId = stockPositions.length > 0
          ? stockPositions[0].id.replace(/__slot_\d+$/, '')
          : (strategy.linkedStockId || null);

        configs.push({
          underlying,
          strategy_type: strategy.strategyType,
          position_signatures: buildSignatures(strategy.positions),
          is_synthetic: strategy.isSynthetic,
          linked_stock_id: realStockId,
          linked_stock_slot_ids: stockSlotIds,
          sort_order: sortIdx++,
        });
      }
    }

    // Preserve unchanged configs (including their linked_stock_slot_ids)
    for (const config of allConfigs) {
      if (affectedUnderlyings.has(config.underlying)) continue;
      configs.push({
        underlying: config.underlying,
        strategy_type: config.strategy_type,
        position_signatures: config.position_signatures as unknown as PositionSignature[],
        is_synthetic: config.is_synthetic,
        linked_stock_id: config.linked_stock_id,
        linked_stock_slot_ids: config.linked_stock_slot_ids || [],
        sort_order: sortIdx++,
      });
    }

    await onSave(configs);
    onOpenChange(false);
  };

  if (items.length === 0) return null;

  const entries = Array.from(underlyingStates.entries());

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-500" />
            Configurazioni da aggiornare
          </DialogTitle>
          <DialogDescription>
            Sono state rilevate differenze tra le configurazioni salvate e le posizioni attuali.
            Riconfigura le strategie per {entries.length} sottostant{entries.length === 1 ? 'e' : 'i'}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto pr-2">
          <div className="space-y-3 pb-4 pt-2">
            {entries.map(([key, state]) => {
              const selectedSet = selectedByGroup.get(key) || new Set<string>();
              // Derive effective available positions considering splits
              const rawAvailable = state.availablePositions.filter(p => !assignedIds.has(p.id));
              const effectiveAvailable: Position[] = [];
              for (const p of rawAvailable) {
                if (splitPositionIds.has(p.id)) {
                  if (p.asset_type === 'derivative' && Math.abs(p.quantity) > 1) {
                    const absQty = Math.abs(p.quantity);
                    const sign = p.quantity >= 0 ? 1 : -1;
                    for (let i = 0; i < absQty; i++) {
                      effectiveAvailable.push({ ...p, id: `${p.id}__opt_slot_${i}`, quantity: sign * 1 });
                    }
                  } else if ((p.asset_type === 'stock' || p.asset_type === 'etf') && p.quantity >= 200) {
                    const slots = Math.floor(p.quantity / 100);
                    for (let i = 0; i < slots; i++) {
                      effectiveAvailable.push({ ...p, id: `${p.id}__slot_${i}`, quantity: 100 });
                    }
                    const remainder = p.quantity % 100;
                    if (remainder > 0) {
                      effectiveAvailable.push({ ...p, id: `${p.id}__slot_${slots}`, quantity: remainder });
                    }
                  } else {
                    effectiveAvailable.push(p);
                  }
                } else {
                  effectiveAvailable.push(p);
                }
              }
              const available = effectiveAvailable;
              const selectedCount = available.filter(p => selectedSet.has(p.id)).length;
              const missingCount = state.missingLegs.length;
              const newCount = available.filter(p => p.asset_type === 'derivative').length;

              const handleSplitPosition = (posId: string) => {
                setSplitPositionIds(prev => new Set(prev).add(posId));
              };

              const handleRejoinPosition = (posId: string) => {
                const origPos = rawAvailable.find(p => p.id === posId);
                if (!origPos) return;
                let slotIds: string[] = [];
                if (origPos.asset_type === 'derivative') {
                  const absQty = Math.abs(origPos.quantity);
                  slotIds = Array.from({ length: absQty }, (_, i) => `${posId}__opt_slot_${i}`);
                } else if (origPos.asset_type === 'stock' || origPos.asset_type === 'etf') {
                  const slots = Math.floor(origPos.quantity / 100);
                  const hasRem = origPos.quantity % 100 > 0;
                  slotIds = Array.from({ length: slots + (hasRem ? 1 : 0) }, (_, i) => `${posId}__slot_${i}`);
                }
                const anyAssigned = slotIds.some(id => assignedIds.has(id));
                if (anyAssigned) return;
                setSplitPositionIds(prev => {
                  const next = new Set(prev);
                  next.delete(posId);
                  return next;
                });
              };

              return (
                <Collapsible key={key} defaultOpen>
                  <Card className="border-yellow-500/30">
                    <CollapsibleTrigger className="w-full">
                      <CardHeader className="pb-2 pt-3 px-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
                            <span className="text-sm font-bold uppercase">{state.underlying}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {missingCount > 0 && (
                              <Badge variant="outline" className="text-[10px] border-destructive/50 text-destructive">
                                {missingCount} rimoss{missingCount === 1 ? 'a' : 'e'}
                              </Badge>
                            )}
                            {newCount > 0 && (
                              <Badge variant="outline" className="text-[10px] border-blue-500/50 text-blue-500">
                                {newCount} nuov{newCount === 1 ? 'a' : 'e'}
                              </Badge>
                            )}
                            {state.strategies.length > 0 && (
                              <Badge variant="secondary" className="text-[10px]">
                                {state.strategies.length} {state.strategies.length === 1 ? 'strategia' : 'strategie'}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent className="px-4 pb-3 space-y-3">
                        {/* Missing legs banner */}
                        {missingCount > 0 && (
                          <div className="rounded-md bg-destructive/5 border border-destructive/20 p-2">
                            <span className="text-[11px] text-destructive font-medium uppercase tracking-wide block mb-1">
                              Gambe rimosse
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {state.missingLegs.map((leg, i) => (
                                <Badge key={i} variant="outline" className="text-xs border-destructive/40 text-destructive line-through">
                                  {sigLabel(leg.signature)}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Available positions pool */}
                        {available.length > 0 && (
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                                Posizioni disponibili ({available.length})
                              </span>
                              {selectedCount > 0 && (
                                <Button
                                  size="sm"
                                  variant="default"
                                  className="h-6 text-[11px] px-2"
                                  onClick={() => createStrategyFromSelected(key)}
                                >
                                  <Plus className="w-3 h-3 mr-1" />
                                  Crea strategia ({selectedCount})
                                </Button>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {available.map(p => {
                                const baseOptId = p.id.replace(/__opt_slot_\d+$/, '');
                                const baseStockId = p.id.replace(/__slot_\d+$/, '');
                                const isOptSlot = /__opt_slot_\d+$/.test(p.id);
                                const isStockSlot = /__slot_\d+$/.test(p.id);
                                const isGroupedOption = p.asset_type === 'derivative' && Math.abs(p.quantity) > 1 && !isOptSlot;
                                const isGroupedStock = (p.asset_type === 'stock' || p.asset_type === 'etf') && p.quantity >= 200 && !isStockSlot;
                                const canSplit = isGroupedOption || isGroupedStock;

                                const isFirstOptSlot = isOptSlot && p.id.endsWith('__opt_slot_0');
                                const isFirstStockSlot = isStockSlot && p.id.endsWith('__slot_0');
                                const canRejoin = (isFirstOptSlot || isFirstStockSlot) && (() => {
                                  const baseId = isOptSlot ? baseOptId : baseStockId;
                                  const origPos = rawAvailable.find(ap => ap.id === baseId);
                                  if (!origPos) return false;
                                  let slotIds: string[];
                                  if (isOptSlot) {
                                    const absQty = Math.abs(origPos.quantity);
                                    slotIds = Array.from({ length: absQty }, (_, i) => `${baseId}__opt_slot_${i}`);
                                  } else {
                                    const slots = Math.floor(origPos.quantity / 100);
                                    const hasRem = origPos.quantity % 100 > 0;
                                    slotIds = Array.from({ length: slots + (hasRem ? 1 : 0) }, (_, i) => `${baseId}__slot_${i}`);
                                  }
                                  return slotIds.every(id => !assignedIds.has(id));
                                })();

                                const splitTooltip = isGroupedOption
                                  ? `Dividi in ${Math.abs(p.quantity)} contratti singoli`
                                  : `Dividi in slot da 100 azioni`;
                                const rejoinBaseId = isOptSlot ? baseOptId : baseStockId;

                                return (
                                  <div key={p.id} className="inline-flex items-center gap-0.5">
                                    <label
                                      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs cursor-pointer transition-colors ${
                                        selectedSet.has(p.id)
                                          ? 'bg-primary/10 border-primary'
                                          : 'hover:bg-muted/50'
                                      } ${positionBadgeClass(p)}`}
                                    >
                                      <Checkbox
                                        checked={selectedSet.has(p.id)}
                                        onCheckedChange={() => toggleSelected(key, p.id)}
                                        className="w-3.5 h-3.5"
                                      />
                                      {positionLabel(p)}
                                    </label>
                                    {canSplit && (
                                      <TooltipProvider delayDuration={200}>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <button
                                              className="p-0.5 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                                              onClick={(e) => { e.preventDefault(); handleSplitPosition(p.id); }}
                                            >
                                              <Scissors className="w-3.5 h-3.5" />
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent side="top" className="text-xs">
                                            {splitTooltip}
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    )}
                                    {canRejoin && (
                                      <TooltipProvider delayDuration={200}>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <button
                                              className="p-0.5 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                                              onClick={(e) => { e.preventDefault(); handleRejoinPosition(rejoinBaseId); }}
                                            >
                                              <Merge className="w-3.5 h-3.5" />
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent side="top" className="text-xs">
                                            Riunisci
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Configured strategies */}
                        {state.strategies.map(strategy => {
                          const showSynthetic = strategy.strategyType === 'covered_call' || strategy.strategyType === 'derisking_covered_call';
                          return (
                            <div key={strategy.id} className="rounded-md border border-dashed border-border p-2.5 space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Select
                                    value={strategy.strategyType}
                                    onValueChange={(v) => updateStrategyType(key, strategy.id, v)}
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
                                      Suggerito: {STRATEGY_OPTIONS.find(o => o.value === strategy.suggestedType)?.label || strategy.suggestedType}
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
                                        onCheckedChange={() => toggleSynthetic(key, strategy.id)}
                                        className="w-3.5 h-3.5"
                                      />
                                      <Label htmlFor={`syn-${strategy.id}`} className="text-[10px] text-muted-foreground cursor-pointer flex items-center gap-1">
                                        <Zap className="w-3 h-3" /> Sintetica
                                      </Label>
                                    </div>
                                  )}
                                </div>

                                <div className="flex items-center gap-1">
                                  {(() => {
                                    const selSet = selectedByGroup.get(key);
                                    const selCount = selSet ? Array.from(selSet).filter(id => !assignedIds.has(id)).length : 0;
                                    if (selCount === 0) return null;
                                    return (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-6 text-[10px] px-2"
                                        onClick={() => addToStrategy(key, strategy.id)}
                                      >
                                        <Plus className="w-3 h-3 mr-0.5" />
                                        +{selCount}
                                      </Button>
                                    );
                                  })()}
                                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => deleteStrategy(key, strategy.id)}>
                                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                  </Button>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {strategy.positions.map(p => {
                                  const isStockSlot = /__slot_\d+$/.test(p.id);
                                  const isGroupedStock = (p.asset_type === 'stock' || p.asset_type === 'etf') && p.quantity >= 200 && !isStockSlot;
                                  const canSplitInStrategy = isGroupedStock;

                                  return (
                                    <div key={p.id} className="inline-flex items-center gap-0.5">
                                      <Badge
                                        variant="outline"
                                        className={`text-xs pr-1 ${positionBadgeClass(p)}`}
                                      >
                                        {positionLabel(p)}
                                        <button
                                          className="ml-1 hover:text-destructive"
                                          onClick={() => removeFromStrategy(key, strategy.id, p.id)}
                                        >
                                          <X className="w-3 h-3" />
                                        </button>
                                      </Badge>
                                      {canSplitInStrategy && (
                                        <TooltipProvider delayDuration={200}>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <button
                                                className="p-0.5 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                                                onClick={(e) => {
                                                  e.preventDefault();
                                                  // Mark position as split
                                                  handleSplitPosition(p.id);
                                                  // Replace whole stock with first slot in strategy
                                                  setUnderlyingStates(prev => {
                                                    const next = new Map(prev);
                                                    const st = { ...next.get(key)! };
                                                    st.strategies = st.strategies.map(s => {
                                                      if (s.id !== strategy.id) return s;
                                                      const newPositions = s.positions.map(sp => {
                                                        if (sp.id !== p.id) return sp;
                                                        return { ...sp, id: `${sp.id}__slot_0`, quantity: 100 };
                                                      });
                                                      return { ...s, positions: newPositions };
                                                    });
                                                    next.set(key, st);
                                                    return next;
                                                  });
                                                }}
                                              >
                                                <Scissors className="w-3.5 h-3.5" />
                                              </button>
                                            </TooltipTrigger>
                                            <TooltipContent side="top" className="text-xs">
                                              Dividi in slot da 100 azioni
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              );
            })}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Ignora
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            <Check className="w-4 h-4 mr-2" />
            Salva aggiornamenti
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
