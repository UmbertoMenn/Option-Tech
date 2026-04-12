import { useState, useMemo, useCallback, useEffect, startTransition } from 'react';
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
import { Settings2, Check, Zap, Plus, X, Wand2, ChevronDown, ChevronRight, Search, Trash2, Archive, RotateCcw, Scissors, Merge } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
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

interface ArchivedItem {
  key: string;
  displayName: string;
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
  archivedKeys?: string[];
  archivedItems?: ArchivedItem[];
  onArchive?: (key: string, displayName: string) => void;
  onUnarchive?: (key: string) => void;
}

function buildSignatures(positions: Position[]): PositionSignature[] {
  // Group derivative positions by signature key, summing quantities
  const sigMap = new Map<string, PositionSignature & { totalQty: number }>();
  for (const o of positions) {
    if (o.asset_type !== 'derivative') continue;
    const baseId = o.id.replace(/__opt_slot_\d+$/, '');
    const sigKey = `${baseId}::${(o.option_type || '').toLowerCase()}::${o.strike_price || 0}::${o.expiry_date || ''}::${o.quantity >= 0 ? 1 : -1}`;
    if (sigMap.has(sigKey)) {
      // For split slots, each contributes 1; for grouped positions, contribute |quantity|
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
  // Show slot label for split option contracts
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

function getUnderlyingKey(p: Position, allDerivatives: Position[]): string {
  if (p.asset_type === 'derivative') {
    const raw = p.underlying || p.description || '';
    return getCanonicalKey(raw) || normalizeForMatching(raw);
  }
  // Stock or ETF: try canonical first
  const stockText = `${p.description ?? ''} ${p.ticker ?? ''}`;
  const canonical = getCanonicalKey(stockText);
  if (canonical) return canonical;

  // Also try description-only canonical (without ticker noise)
  const descOnly = p.description ?? '';
  const descCanonical = getCanonicalKey(descOnly);
  if (descCanonical) return descCanonical;

  // Try to match against derivative underlyings
  const stockNorm = normalizeForMatching(stockText);
  const descNorm = normalizeForMatching(descOnly);
  
  for (const d of allDerivatives) {
    const dUnderlying = d.underlying || d.description || '';
    const dNorm = normalizeForMatching(dUnderlying);
    const dCanonical = getCanonicalKey(dUnderlying);
    
    // Check includes with both full text and description-only
    if (stockNorm.includes(dNorm) || dNorm.includes(stockNorm) ||
        descNorm.includes(dNorm) || dNorm.includes(descNorm)) {
      return dCanonical || dNorm;
    }
    
    // Token overlap fallback: if significant tokens match, same underlying
    if (hasTokenOverlap(descOnly, dUnderlying)) {
      return dCanonical || dNorm;
    }
  }
  return stockNorm;
}

function autoClassify(derivatives: Position[], allPositions: Position[], archivedKeysToExclude: string[] = []): WizardStrategy[] {
  // Filter out archived underlyings before auto-classifying
  const archivedSet = new Set(archivedKeysToExclude.map(k => k.toUpperCase().trim()));
  const filteredDerivs = archivedSet.size > 0
    ? derivatives.filter(d => {
        const key = (d.underlying || d.description || '').toUpperCase().trim();
        return !archivedSet.has(key);
      })
    : derivatives;
  const result = categorizeDerivatives(filteredDerivs, allPositions, [], []);
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

  // Long Puts → try to merge into existing CC as derisking, otherwise 'other'
  for (const lp of result.longPuts) {
    const legs = addUnique([lp.option]);
    if (legs.length === 0) continue;
    
    const putKey = normalizeForMatching(lp.option.underlying || lp.option.description || '');
    const matchingCC = strategies.find(s => 
      s.strategyType === 'covered_call' &&
      normalizeForMatching(s.positions[0]?.underlying || s.positions[0]?.description || '') === putKey
    );
    
    if (matchingCC) {
      consume(legs);
      matchingCC.positions.push(...legs);
      matchingCC.strategyType = 'derisking_covered_call';
      matchingCC.suggestedType = 'derisking_covered_call';
    } else {
      consume(legs);
      strategies.push(make(legs, 'other'));
    }
  }

  // Other Strategies → detect put_spread / diagonal_put_spread
  for (const group of result.groupedOtherStrategies) {
    const options = group.options.map(o => o.option);
    const unique = addUnique(options);
    if (unique.length > 0) {
      consume(unique);
      const detected = detectStrategyType(unique);
      strategies.push(make(unique, detected));
    }
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
  archivedKeys = [],
  archivedItems = [],
  onArchive,
  onUnarchive,
}: StrategyConfigWizardProps) {
  // Build all available positions (derivatives as-is + stocks as-is) — skip when closed
  const allAvailable = useMemo(() => {
    if (!open) return [];
    const stocks = allPositions.filter(p => p.asset_type === 'stock');
    let derivs = derivatives;
    if (filterUnderlyings) {
      derivs = derivs.filter(d => filterUnderlyings.includes(d.underlying || ''));
    }
    
    // Options enter the pool with their original quantity (no auto-splitting)
    const virtualDerivs: Position[] = [...derivs];
    
    // Stocks enter the pool with original quantity (no auto-splitting)
    const virtualStocks: Position[] = [...stocks];
    
    return [...virtualDerivs, ...virtualStocks];
  }, [open, derivatives, allPositions, filterUnderlyings]);

  // Track which positions the user has manually split (options + stocks)
  const [splitPositionIds, setSplitPositionIds] = useState<Set<string>>(new Set());

  // Derive effective positions: expand split options into single-contract slots, split stocks into 100-share slots
  const effectivePositions = useMemo(() => {
    if (splitPositionIds.size === 0) return allAvailable;
    const result: Position[] = [];
    for (const p of allAvailable) {
      if (splitPositionIds.has(p.id)) {
        if (p.asset_type === 'derivative' && Math.abs(p.quantity) > 1) {
          const absQty = Math.abs(p.quantity);
          const sign = p.quantity >= 0 ? 1 : -1;
          for (let i = 0; i < absQty; i++) {
            result.push({ ...p, id: `${p.id}__opt_slot_${i}`, quantity: sign * 1 });
          }
        } else if ((p.asset_type === 'stock' || p.asset_type === 'etf') && p.quantity >= 200) {
          const slots = Math.floor(p.quantity / 100);
          for (let i = 0; i < slots; i++) {
            result.push({ ...p, id: `${p.id}__slot_${i}`, quantity: 100 });
          }
          const remainder = p.quantity % 100;
          if (remainder > 0) {
            result.push({ ...p, id: `${p.id}__slot_${slots}`, quantity: remainder });
          }
        } else {
          result.push(p);
        }
      } else {
        result.push(p);
      }
    }
    return result;
  }, [allAvailable, splitPositionIds]);

  // Group all positions by normalized underlying — skip when closed
  const underlyingGroups = useMemo((): UnderlyingGroup[] => {
    if (!open) return [];
    const groupMap = new Map<string, { displayName: string; positions: Position[] }>();
    const derivsOnlyForGroups = effectivePositions.filter(p => p.asset_type === 'derivative');
    // Pre-compute underlying key map for O(n) total instead of O(n²)
    const keyMapForGroups = new Map<string, string>();
    for (const p of effectivePositions) {
      keyMapForGroups.set(p.id, getUnderlyingKey(p, derivsOnlyForGroups));
    }

    for (const p of effectivePositions) {
      const key = keyMapForGroups.get(p.id) || getUnderlyingKey(p, derivsOnlyForGroups);
      if (!groupMap.has(key)) {
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

    return Array.from(groupMap.entries())
      .map(([key, { displayName, positions }]) => ({ key, displayName, positions }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [open, effectivePositions]);

  const [strategies, setStrategies] = useState<WizardStrategy[]>([]);
  const [selectedIdsByGroup, setSelectedIdsByGroup] = useState<Map<string, Set<string>>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');

  // Assigned position ids across all strategies
  const assignedIds = useMemo(() => {
    const ids = new Set<string>();
    strategies.forEach(s => s.positions.forEach(p => ids.add(p.id)));
    return ids;
  }, [strategies]);

  const restoreFromConfigs = useCallback((): { strategies: WizardStrategy[], autoSplitIds: Set<string> } => {
    if (!existingConfigs || existingConfigs.length === 0) return { strategies: [], autoSplitIds: new Set() };
    // Work with allAvailable (non-split options) to detect which ones need splitting
    const derivsOnlyRestore = allAvailable.filter(pp => pp.asset_type === 'derivative');
    const keyMapRestore = new Map<string, string>();
    for (const p of allAvailable) {
      keyMapRestore.set(p.id, getUnderlyingKey(p, derivsOnlyRestore));
    }
    const usedIds = new Set<string>();
    const restored: WizardStrategy[] = [];
    const autoSplitIds = new Set<string>();

    // First pass: detect which positions need splitting
    // An option needs splitting if a config uses quantity_abs < |original quantity|
    // A stock needs splitting if config has multiple linked_stock_slot_ids
    for (const config of existingConfigs) {
      const signatures = (config.position_signatures as unknown as PositionSignature[]) || [];
      const slotIdsForCheck = (config.linked_stock_slot_ids as unknown as string[]) || [];
      if (signatures.length === 0 && slotIdsForCheck.length === 0 && !config.linked_stock_id) continue;
      const configUnderlyingKey = getCanonicalKey(config.underlying) || normalizeForMatching(config.underlying);

      // Check options
      for (const sig of signatures) {
        const qtyNeeded = sig.quantity_abs || 1;
        const originalOption = allAvailable.find(p => {
          if (p.asset_type !== 'derivative') return false;
          if (keyMapRestore.get(p.id) !== configUnderlyingKey) return false;
          const optType = (p.option_type || '').toLowerCase();
          const sigType = (sig.option_type || '').toLowerCase();
          if (optType !== sigType) return false;
          if (Math.abs((p.strike_price || 0) - sig.strike) > 0.01) return false;
          if ((p.expiry_date || '') !== (sig.expiry || '')) return false;
          const posSign = p.quantity >= 0 ? 1 : -1;
          if (posSign !== sig.quantity_sign) return false;
          return true;
        });
        if (originalOption && Math.abs(originalOption.quantity) > 1 && qtyNeeded < Math.abs(originalOption.quantity)) {
          autoSplitIds.add(originalOption.id);
        }
      }

      // Check stocks: if ANY config references a __slot_ ID, auto-split the base stock
      // This ensures that even a single slot reference triggers splitting so sibling configs
      // can each claim their own slot.
      const savedSlotIds = (config.linked_stock_slot_ids as unknown as string[]) || [];
      const hasSlotRef = savedSlotIds.some(id => /__slot_\d+$/.test(id));
      if (hasSlotRef) {
        for (const slotId of savedSlotIds) {
          const baseStockId = slotId.replace(/__slot_\d+$/, '');
          const stock = allAvailable.find(p => p.id === baseStockId && (p.asset_type === 'stock' || p.asset_type === 'etf'));
          if (stock && stock.quantity >= 200) {
            autoSplitIds.add(stock.id);
          }
        }
      }
    }

    // Build effective positions for restore (with splits applied)
    const restorePositions: Position[] = [];
    for (const p of allAvailable) {
      if (autoSplitIds.has(p.id)) {
        if (p.asset_type === 'derivative' && Math.abs(p.quantity) > 1) {
          const absQty = Math.abs(p.quantity);
          const sign = p.quantity >= 0 ? 1 : -1;
          for (let i = 0; i < absQty; i++) {
            restorePositions.push({ ...p, id: `${p.id}__opt_slot_${i}`, quantity: sign * 1 });
          }
        } else if ((p.asset_type === 'stock' || p.asset_type === 'etf') && p.quantity >= 200) {
          const slots = Math.floor(p.quantity / 100);
          for (let i = 0; i < slots; i++) {
            restorePositions.push({ ...p, id: `${p.id}__slot_${i}`, quantity: 100 });
          }
          const remainder = p.quantity % 100;
          if (remainder > 0) {
            restorePositions.push({ ...p, id: `${p.id}__slot_${slots}`, quantity: remainder });
          }
        } else {
          restorePositions.push(p);
        }
      } else {
        restorePositions.push(p);
      }
    }

    // Re-compute key map for restore positions
    const derivsOnlyRestore2 = restorePositions.filter(pp => pp.asset_type === 'derivative');
    const keyMapRestore2 = new Map<string, string>();
    for (const p of restorePositions) {
      keyMapRestore2.set(p.id, getUnderlyingKey(p, derivsOnlyRestore2));
    }

    for (const config of existingConfigs) {
      const signatures = (config.position_signatures as unknown as PositionSignature[]) || [];
      const savedSlotIdsForRestore = (config.linked_stock_slot_ids as unknown as string[]) || [];
      if (signatures.length === 0 && savedSlotIdsForRestore.length === 0 && !config.linked_stock_id) continue;

      const configUnderlyingKey = getCanonicalKey(config.underlying) || normalizeForMatching(config.underlying);
      const groupPositions = restorePositions.filter(p => keyMapRestore2.get(p.id) === configUnderlyingKey);

      const matched: Position[] = [];

      for (const sig of signatures) {
        const qtyNeeded = sig.quantity_abs || 1;
        for (let qi = 0; qi < qtyNeeded; qi++) {
          const match = groupPositions.find(p => {
            if (usedIds.has(p.id)) return false;
            if (p.asset_type !== 'derivative') return false;
            const optType = (p.option_type || '').toLowerCase();
            const sigType = (sig.option_type || '').toLowerCase();
            if (optType !== sigType) return false;
            if (Math.abs((p.strike_price || 0) - sig.strike) > 0.01) return false;
            if ((p.expiry_date || '') !== (sig.expiry || '')) return false;
            const posSign = p.quantity >= 0 ? 1 : -1;
            if (posSign !== sig.quantity_sign) return false;
            return true;
          });
          if (match) {
            usedIds.add(match.id);
            matched.push(match);
          }
        }
      }

      // Restore stock slots from linked_stock_slot_ids (preferred) or legacy linked_stock_id
      const savedSlotIds = (config.linked_stock_slot_ids as unknown as string[]) || [];
      if (savedSlotIds.length > 0) {
        for (const slotId of savedSlotIds) {
          const stockSlot = groupPositions.find(p =>
            !usedIds.has(p.id) && p.asset_type === 'stock' && p.id === slotId
          );
          if (stockSlot) {
            usedIds.add(stockSlot.id);
            matched.push(stockSlot);
          }
        }
      } else if (config.linked_stock_id) {
        const stockSlot = groupPositions.find(p =>
          !usedIds.has(p.id) &&
          p.asset_type === 'stock' &&
          (p.id === config.linked_stock_id || p.id.startsWith(config.linked_stock_id + '__slot_'))
        );
        if (stockSlot) {
          usedIds.add(stockSlot.id);
          matched.push(stockSlot);
        }
      }
      // Fallback: for CC/DRCC strategies, auto-assign first available stock in group
      if (!matched.some(p => p.asset_type === 'stock') && 
          (config.strategy_type === 'covered_call' || config.strategy_type === 'derisking_covered_call')) {
        const fallbackStock = groupPositions.find(p => !usedIds.has(p.id) && p.asset_type === 'stock');
        if (fallbackStock) {
          usedIds.add(fallbackStock.id);
          matched.push(fallbackStock);
        }
      }

      if (matched.length > 0) {
        restored.push({
          id: genId(),
          positions: matched,
          strategyType: config.strategy_type,
          isSynthetic: config.is_synthetic || false,
          suggestedType: config.strategy_type,
        });
      }
    }

    return { strategies: restored, autoSplitIds };
  }, [existingConfigs, allAvailable]);

  // Restore saved configs when wizard opens — use ref to avoid re-running on reactive updates
  const hasInitialized = useMemo(() => ({ current: false }), []);
  useEffect(() => {
    if (open && !hasInitialized.current) {
      hasInitialized.current = true;
      startTransition(() => {
        const { strategies: restored, autoSplitIds } = restoreFromConfigs();
        setStrategies(restored);
        setSplitPositionIds(autoSplitIds);
      });
      setSelectedIdsByGroup(new Map());
      setSearchQuery('');
    }
    if (!open) {
      hasInitialized.current = false;
    }
  }, [open, restoreFromConfigs, hasInitialized]);

  const handleOpenChange = useCallback((isOpen: boolean) => {
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

  const addToStrategy = (groupKey: string, strategyId: string, groupPositions: Position[]) => {
    const selectedSet = selectedIdsByGroup.get(groupKey);
    if (!selectedSet || selectedSet.size === 0) return;
    const toAdd = groupPositions.filter(p => !assignedIds.has(p.id) && selectedSet.has(p.id));
    if (toAdd.length === 0) return;

    setStrategies(prev => prev.map(st => {
      if (st.id !== strategyId) return st;
      const newPositions = [...st.positions, ...toAdd];
      return { ...st, positions: newPositions, suggestedType: detectStrategyType(newPositions) };
    }));
    setSelectedIdsByGroup(prev => { const next = new Map(prev); next.delete(groupKey); return next; });
  };

  const handleAutoClassify = () => {
    startTransition(() => {
      const auto = autoClassify(derivatives, allPositions, archivedKeys);
      
      // Remap original stock IDs to virtual slot IDs
      const usedSlotIds = new Set<string>();
      const remappedStrategies = auto.map(strat => ({
        ...strat,
        positions: strat.positions.map(p => {
          if (p.asset_type !== 'stock') return p;
          // Find matching virtual slot in allAvailable
          const slot = effectivePositions.find(a =>
            (a.id.startsWith(p.id + '__slot_') || a.id === p.id) && !usedSlotIds.has(a.id)
          );
          if (slot && slot.id !== p.id) {
            usedSlotIds.add(slot.id);
            return { ...p, id: slot.id, quantity: slot.quantity };
          }
          return p;
        }),
      }));
      
      setStrategies(remappedStrategies);
      setSelectedIdsByGroup(new Map());
    });
  };

  const handleSave = async () => {
    const rawConfigs: UpsertConfigParams[] = [];

    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];
      const derivPos = strategy.positions.find(p => p.asset_type === 'derivative');
      const underlying = derivPos
        ? (derivPos.underlying || derivPos.description || 'Unknown')
        : (getCanonicalKey(strategy.positions[0]?.description || '') || getCanonicalKey(`${strategy.positions[0]?.description || ''} ${strategy.positions[0]?.ticker || ''}`) || strategy.positions[0]?.description || 'Unknown');
      const stockPositions = strategy.positions.filter(p => p.asset_type === 'stock' || p.asset_type === 'etf');
      const slotIds = stockPositions.map(p => p.id); // preserve full slot IDs including __slot_N
      const realStockId = stockPositions[0]?.id?.replace(/__slot_\d+$/, '') || null;

      rawConfigs.push({
        underlying,
        strategy_type: strategy.strategyType,
        position_signatures: buildSignatures(strategy.positions),
        is_synthetic: strategy.isSynthetic,
        linked_stock_id: realStockId,
        linked_stock_slot_ids: slotIds,
        sort_order: i,
      });
    }

    if (filterUnderlyings) {
      for (const existing of existingConfigs) {
        if (!rawConfigs.some(c => c.underlying === existing.underlying)) {
          rawConfigs.push({
            underlying: existing.underlying,
            strategy_type: existing.strategy_type,
            position_signatures: existing.position_signatures,
            is_synthetic: existing.is_synthetic,
            linked_stock_id: existing.linked_stock_id,
            linked_stock_slot_ids: existing.linked_stock_slot_ids || [],
          });
        }
      }
    }

    // NO deduplication — each strategy is saved as a separate row
    await onSave(rawConfigs);
    onOpenChange(false);
  };

  const strategyLabel = (type: string) => STRATEGY_OPTIONS.find(o => o.value === type)?.label || type;

  // Filter groups by search AND exclude archived
  const filteredGroups = useMemo(() => {
    let groups = underlyingGroups.filter(g => !archivedKeys.includes(g.key));
    if (!searchQuery.trim()) return groups;
    const q = searchQuery.toLowerCase();
    return groups.filter(g =>
      g.displayName.toLowerCase().includes(q) ||
      g.key.toLowerCase().includes(q) ||
      g.positions.some(p =>
        (p.ticker || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q)
      )
    );
  }, [underlyingGroups, searchQuery, archivedKeys]);

  // Get strategies for a specific underlying group
  const getStrategiesForGroup = (groupKey: string, groupPositions: Position[]) => {
    const groupPosIds = new Set(groupPositions.map(p => p.id));
    return strategies.filter(s => s.positions.some(p => groupPosIds.has(p.id)));
  };

  const totalStrategies = strategies.length;
  const archivedPosIds = useMemo(() => {
    const ids = new Set<string>();
    underlyingGroups.filter(g => archivedKeys.includes(g.key)).forEach(g => g.positions.forEach(p => ids.add(p.id)));
    return ids;
  }, [underlyingGroups, archivedKeys]);
  const totalUnassigned = effectivePositions.filter(p => !assignedIds.has(p.id) && !archivedPosIds.has(p.id)).length;
  const [archiveOpen, setArchiveOpen] = useState(false);

  // Split position handler (options or stocks)
  const handleSplitPosition = (posId: string) => {
    setSplitPositionIds(prev => new Set(prev).add(posId));
  };

  // Rejoin handler — only if no slots are assigned
  const handleRejoinPosition = (posId: string) => {
    const pos = allAvailable.find(p => p.id === posId);
    if (!pos) return;
    // Determine slot pattern based on type
    let slotIds: string[] = [];
    if (pos.asset_type === 'derivative') {
      const absQty = Math.abs(pos.quantity);
      slotIds = Array.from({ length: absQty }, (_, i) => `${posId}__opt_slot_${i}`);
    } else if (pos.asset_type === 'stock' || pos.asset_type === 'etf') {
      const slots = Math.floor(pos.quantity / 100);
      const hasRemainder = pos.quantity % 100 > 0;
      slotIds = Array.from({ length: slots + (hasRemainder ? 1 : 0) }, (_, i) => `${posId}__slot_${i}`);
    }
    const anyAssigned = slotIds.some(id => assignedIds.has(id));
    if (anyAssigned) return;
    setSplitPositionIds(prev => {
      const next = new Set(prev);
      next.delete(posId);
      return next;
    });
  };

  if (effectivePositions.length === 0) return null;

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
                          {groupStrategies.length === 0 && onArchive && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                              onClick={(e) => {
                                e.stopPropagation();
                                onArchive(group.key, group.displayName);
                              }}
                            >
                              <Archive className="w-3.5 h-3.5 mr-1" />
                              Archivia
                            </Button>
                          )}
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
                              {availablePositions.map(p => {
                                const baseOptId = p.id.replace(/__opt_slot_\d+$/, '');
                                const baseStockId = p.id.replace(/__slot_\d+$/, '');
                                const isOptSlot = /__opt_slot_\d+$/.test(p.id);
                                const isStockSlot = /__slot_\d+$/.test(p.id);
                                const isGroupedOption = p.asset_type === 'derivative' && Math.abs(p.quantity) > 1 && !isOptSlot;
                                const isGroupedStock = (p.asset_type === 'stock' || p.asset_type === 'etf') && p.quantity >= 200 && !isStockSlot;
                                const canSplit = isGroupedOption || isGroupedStock;
                                
                                // Show rejoin on first slot of a split group
                                const isFirstOptSlot = isOptSlot && p.id.endsWith('__opt_slot_0');
                                const isFirstStockSlot = isStockSlot && p.id.endsWith('__slot_0');
                                const canRejoin = (isFirstOptSlot || isFirstStockSlot) && (() => {
                                  const baseId = isOptSlot ? baseOptId : baseStockId;
                                  const origPos = allAvailable.find(ap => ap.id === baseId);
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
                                        onCheckedChange={() => toggleSelected(group.key, p.id)}
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

                                <div className="flex items-center gap-1 shrink-0">
                                  {selectedCount > 0 && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-6 text-[11px] px-2"
                                      onClick={() => addToStrategy(group.key, strategy.id, group.positions)}
                                    >
                                      <Plus className="w-3 h-3 mr-0.5" />
                                      +{selectedCount}
                                    </Button>
                                  )}
                                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteStrategy(strategy.id)}>
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
                                          onClick={() => removeFromStrategy(strategy.id, p.id)}
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
                                                  // Split the stock: mark as split, replace in strategy with first slot only
                                                  setSplitPositionIds(prev => new Set(prev).add(p.id));
                                                  setStrategies(prev => prev.map(s => {
                                                    if (s.id !== strategy.id) return s;
                                                    const newPositions = s.positions.map(sp => {
                                                      if (sp.id !== p.id) return sp;
                                                      // Replace whole stock with first slot
                                                      return { ...sp, id: `${sp.id}__slot_0`, quantity: 100 };
                                                    });
                                                    return { ...s, positions: newPositions };
                                                  }));
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

                        {availablePositions.length === 0 && groupStrategies.length === 0 && (
                          <p className="text-xs text-muted-foreground py-1">Nessuna posizione disponibile.</p>
                        )}
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              );
            })}
            {/* Archived section */}
            {archivedItems.length > 0 && onUnarchive && (
              <Collapsible open={archiveOpen} onOpenChange={setArchiveOpen}>
                <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                  {archiveOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <Archive className="w-4 h-4" />
                  Archivio ({archivedItems.length} sottostant{archivedItems.length === 1 ? 'e' : 'i'})
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-1 pl-6 pt-1">
                    {archivedItems.map(item => (
                      <div key={item.key} className="flex items-center justify-between py-1.5 px-3 rounded-md border border-dashed border-border">
                        <span className="text-xs font-medium uppercase">{item.displayName}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[11px] px-2"
                          onClick={() => onUnarchive(item.key)}
                        >
                          <RotateCcw className="w-3.5 h-3.5 mr-1" />
                          Ripristina
                        </Button>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
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
