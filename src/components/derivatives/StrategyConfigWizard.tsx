import { useState, useMemo } from 'react';
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
import { Settings2, Check, Zap } from 'lucide-react';
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

interface UnderlyingGroup {
  underlying: string;
  options: Position[];
  stocks: Position[];
  suggestedType: string;
  hasSoldCalls: boolean;
  hasBoughtPuts: boolean;
  hasSoldPuts: boolean;
  hasBoughtCalls: boolean;
  hasStock: boolean;
}

interface StrategyConfigWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  derivatives: Position[];
  allPositions: Position[];
  existingConfigs: StrategyConfiguration[];
  onSave: (configs: UpsertConfigParams[]) => Promise<void>;
  isSaving: boolean;
  /** If set, only show these underlyings (for partial re-config) */
  filterUnderlyings?: string[];
}

function buildSignatures(options: Position[]): PositionSignature[] {
  return options.map(o => ({
    option_type: o.option_type || 'unknown',
    strike: o.strike_price || 0,
    expiry: o.expiry_date || '',
    quantity_sign: o.quantity >= 0 ? 1 : -1,
  }));
}

function suggestStrategyType(group: UnderlyingGroup): string {
  const { hasSoldCalls, hasBoughtPuts, hasSoldPuts, hasBoughtCalls, hasStock, options } = group;
  
  const callCount = options.filter(o => o.option_type === 'call').length;
  const putCount = options.filter(o => o.option_type === 'put').length;
  
  // 4-leg strategies
  if (callCount >= 2 && putCount >= 2) {
    const expiries = new Set(options.map(o => o.expiry_date));
    if (expiries.size === 1) return 'iron_condor';
    if (expiries.size > 1) return 'double_diagonal';
  }
  
  // CC with protection
  if (hasSoldCalls && hasStock && hasBoughtPuts) return 'derisking_covered_call';
  
  // Pure CC
  if (hasSoldCalls && hasStock) return 'covered_call';
  
  // Naked Put
  if (hasSoldPuts && !hasStock && !hasBoughtCalls) return 'naked_put';
  
  // LEAP Call
  if (hasBoughtCalls && !hasSoldCalls && !hasSoldPuts) return 'leap_call';
  
  return 'other';
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
  // Group derivatives by underlying
  const underlyingGroups = useMemo(() => {
    const stockPositions = allPositions.filter(p => p.asset_type === 'stock');
    const groups = new Map<string, { options: Position[]; normalizedKey: string }>();
    
    for (const d of derivatives) {
      const name = d.underlying || d.description || '';
      const key = normalizeForMatching(name);
      if (!groups.has(key)) {
        groups.set(key, { options: [], normalizedKey: key });
      }
      groups.get(key)!.options.push(d);
    }
    
    const result: UnderlyingGroup[] = [];
    
    for (const [, group] of groups) {
      const underlying = group.options[0].underlying || group.options[0].description || '';
      
      // Filter if needed
      if (filterUnderlyings && !filterUnderlyings.includes(underlying)) continue;
      
      const matchingStocks = stockPositions.filter(s => {
        const stockKey = normalizeForMatching(s.description || s.ticker || '');
        return stockKey === group.normalizedKey || 
               stockKey.includes(group.normalizedKey) || 
               group.normalizedKey.includes(stockKey);
      });
      
      const hasSoldCalls = group.options.some(o => o.option_type === 'call' && o.quantity < 0);
      const hasBoughtPuts = group.options.some(o => o.option_type === 'put' && o.quantity > 0);
      const hasSoldPuts = group.options.some(o => o.option_type === 'put' && o.quantity < 0);
      const hasBoughtCalls = group.options.some(o => o.option_type === 'call' && o.quantity > 0);
      const hasStock = matchingStocks.some(s => s.quantity > 0);
      
      const g: UnderlyingGroup = {
        underlying,
        options: group.options.sort((a, b) => {
          const typeOrder = { put: 0, call: 1 };
          const ta = typeOrder[a.option_type as keyof typeof typeOrder] ?? 2;
          const tb = typeOrder[b.option_type as keyof typeof typeOrder] ?? 2;
          if (ta !== tb) return ta - tb;
          return (a.strike_price || 0) - (b.strike_price || 0);
        }),
        stocks: matchingStocks,
        suggestedType: '',
        hasSoldCalls,
        hasBoughtPuts,
        hasSoldPuts,
        hasBoughtCalls,
        hasStock,
      };
      g.suggestedType = suggestStrategyType(g);
      result.push(g);
    }
    
    return result.sort((a, b) => a.underlying.localeCompare(b.underlying));
  }, [derivatives, allPositions, filterUnderlyings]);

  // Initialize selections from existing configs or suggestions
  const [selections, setSelections] = useState<Record<string, { type: string; isSynthetic: boolean }>>(() => {
    const init: Record<string, { type: string; isSynthetic: boolean }> = {};
    for (const g of underlyingGroups) {
      const existing = existingConfigs.find(c => c.underlying === g.underlying);
      init[g.underlying] = {
        type: existing?.strategy_type || g.suggestedType,
        isSynthetic: existing?.is_synthetic || false,
      };
    }
    return init;
  });

  // Reset selections when groups change
  useMemo(() => {
    setSelections(prev => {
      const next = { ...prev };
      for (const g of underlyingGroups) {
        if (!next[g.underlying]) {
          const existing = existingConfigs.find(c => c.underlying === g.underlying);
          next[g.underlying] = {
            type: existing?.strategy_type || g.suggestedType,
            isSynthetic: existing?.is_synthetic || false,
          };
        }
      }
      return next;
    });
  }, [underlyingGroups, existingConfigs]);

  const handleSave = async () => {
    const configs: UpsertConfigParams[] = [];
    
    for (const group of underlyingGroups) {
      const sel = selections[group.underlying];
      if (!sel) continue;
      
      configs.push({
        underlying: group.underlying,
        strategy_type: sel.type,
        position_signatures: buildSignatures(group.options),
        is_synthetic: sel.isSynthetic,
        linked_stock_id: group.stocks[0]?.id || null,
      });
    }
    
    // Also keep existing configs for underlyings not in this wizard
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
    
    await onSave(configs);
    onOpenChange(false);
  };

  if (underlyingGroups.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5" />
            Configurazione Strategie Derivati
          </DialogTitle>
          <DialogDescription>
            Classifica le opzioni per sottostante. La configurazione verrà ricordata per i prossimi upload.
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4 pb-4">
            {underlyingGroups.map(group => {
              const sel = selections[group.underlying] || { type: group.suggestedType, isSynthetic: false };
              const showSynthetic = sel.type === 'covered_call' || sel.type === 'derisking_covered_call';
              
              return (
                <Card key={group.underlying} className="border-border">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="text-base font-semibold truncate">
                        {group.underlying}
                      </CardTitle>
                      <div className="flex items-center gap-2 shrink-0">
                        {group.hasStock && (
                          <Badge variant="outline" className="text-[10px]">
                            STOCK: {group.stocks[0]?.quantity}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-3">
                    {/* Option legs */}
                    <div className="flex flex-wrap gap-1.5">
                      {group.options.map(opt => (
                        <Badge
                          key={opt.id}
                          variant="outline"
                          className={`text-xs ${
                            opt.quantity < 0
                              ? 'border-green-500/50 text-green-500'
                              : 'border-red-500/50 text-red-500'
                          }`}
                        >
                          {opt.quantity < 0 ? 'V' : 'A'}{' '}
                          {opt.option_type?.toUpperCase()} {opt.strike_price}{' '}
                          {formatExpiryMMY(opt.expiry_date)}
                          {Math.abs(opt.quantity) > 1 ? ` ×${Math.abs(opt.quantity)}` : ''}
                        </Badge>
                      ))}
                    </div>
                    
                    {/* Strategy selector */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <Select
                        value={sel.type}
                        onValueChange={(value) =>
                          setSelections(prev => ({
                            ...prev,
                            [group.underlying]: { ...prev[group.underlying], type: value },
                          }))
                        }
                      >
                        <SelectTrigger className="w-56 h-9">
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
                      
                      {showSynthetic && (
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={`synthetic-${group.underlying}`}
                            checked={sel.isSynthetic}
                            onCheckedChange={(checked) =>
                              setSelections(prev => ({
                                ...prev,
                                [group.underlying]: { ...prev[group.underlying], isSynthetic: !!checked },
                              }))
                            }
                          />
                          <Label
                            htmlFor={`synthetic-${group.underlying}`}
                            className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1"
                          >
                            <Zap className="w-3 h-3" />
                            Sintetica
                          </Label>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </ScrollArea>
        
        <DialogFooter className="pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            <Check className="w-4 h-4 mr-2" />
            {isSaving ? 'Salvataggio...' : 'Salva Configurazione'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
