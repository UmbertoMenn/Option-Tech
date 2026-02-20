import { useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { AdjustmentRule, AdjustmentAction, getPresetRules, describeRule, StrategyPresetType } from '@/lib/adjustmentRules';

interface AdjustmentRuleEditorProps {
  rules: AdjustmentRule[];
  onRulesChange: (rules: AdjustmentRule[]) => void;
  strategyType: StrategyPresetType;
}

export function AdjustmentRuleEditor({ rules, onRulesChange, strategyType }: AdjustmentRuleEditorProps) {
  const loadPreset = useCallback(() => {
    onRulesChange(getPresetRules(strategyType));
  }, [strategyType, onRulesChange]);

  const addCustomRule = useCallback(() => {
    const newRule: AdjustmentRule = {
      id: `custom_${Date.now()}`,
      name: 'Nuova regola',
      condition: { type: 'price_near_barrier', legType: 'sold_put', distancePct: 5 },
      action: { type: 'roll_strike', newBarrierPct: 10, rollMonths: 1 },
      strikeStep: 5,
      priority: rules.length + 1,
    };
    onRulesChange([...rules, newRule]);
  }, [rules, onRulesChange]);

  const removeRule = useCallback((id: string) => {
    onRulesChange(rules.filter(r => r.id !== id));
  }, [rules, onRulesChange]);

  const updateRule = useCallback((id: string, updates: Partial<AdjustmentRule>) => {
    onRulesChange(rules.map(r => r.id === id ? { ...r, ...updates } : r));
  }, [rules, onRulesChange]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Regole di Aggiustamento</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadPreset}>
            Carica Preset {strategyType.replace(/_/g, ' ')}
          </Button>
          <Button variant="outline" size="sm" onClick={addCustomRule}>
            <Plus className="w-4 h-4 mr-1" /> Custom
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {rules.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nessuna regola configurata. Carica un preset o aggiungi regole custom.
          </p>
        )}

        {rules.map((rule, idx) => (
          <div key={rule.id} className="border rounded-lg p-3 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GripVertical className="w-4 h-4 text-muted-foreground" />
                <Badge variant="outline" className="text-xs">#{idx + 1}</Badge>
                <Input
                  value={rule.name}
                  onChange={e => updateRule(rule.id, { name: e.target.value })}
                  className="h-7 text-sm w-48"
                />
              </div>
              <Button variant="ghost" size="icon" onClick={() => removeRule(rule.id)}>
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Condition */}
              <div className="space-y-2">
                <Label className="text-xs">Condizione</Label>
                <Select
                  value={rule.condition.legType}
                  onValueChange={v => updateRule(rule.id, {
                    condition: { ...rule.condition, legType: v as 'sold_put' | 'sold_call' }
                  })}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sold_put">Put venduta</SelectItem>
                    <SelectItem value="sold_call">Call venduta</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1">
                  <Label className="text-xs whitespace-nowrap">Distanza attivazione</Label>
                  <Input
                    type="number"
                    value={rule.condition.distancePct}
                    onChange={e => updateRule(rule.id, {
                      condition: { ...rule.condition, distancePct: parseFloat(e.target.value) || 5 }
                    })}
                    className="h-8 text-xs w-16"
                  />
                  <span className="text-xs">%</span>
                </div>
              </div>

              {/* Action */}
              <div className="space-y-2">
                <Label className="text-xs">Azione</Label>
                <Select
                  value={rule.action.type}
                  onValueChange={v => updateRule(rule.id, {
                    action: { ...rule.action, type: v as AdjustmentAction['type'] }
                  })}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="roll_strike">Rolla barriera</SelectItem>
                    <SelectItem value="roll_expiry">Rolla scadenza</SelectItem>
                    <SelectItem value="roll_both">Rolla entrambi</SelectItem>
                  </SelectContent>
                </Select>

                {(rule.action.type === 'roll_strike' || rule.action.type === 'roll_both') && (
                  <div className="flex items-center gap-1">
                    <Label className="text-xs whitespace-nowrap">Nuova barriera</Label>
                    <Input
                      type="number"
                      value={rule.action.newBarrierPct}
                      onChange={e => updateRule(rule.id, {
                        action: { ...rule.action, newBarrierPct: parseFloat(e.target.value) || 10 }
                      })}
                      className="h-8 text-xs w-16"
                    />
                    <span className="text-xs">%</span>
                  </div>
                )}

                {(rule.action.type === 'roll_expiry' || rule.action.type === 'roll_both') && (
                  <div className="flex items-center gap-1">
                    <Label className="text-xs whitespace-nowrap">Mesi avanti</Label>
                    <Input
                      type="number"
                      value={rule.action.rollMonths}
                      onChange={e => updateRule(rule.id, {
                        action: { ...rule.action, rollMonths: parseInt(e.target.value) || 1 }
                      })}
                      className="h-8 text-xs w-16"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Strike step + Priority */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Strike step</Label>
                <Input
                  type="number"
                  value={rule.strikeStep}
                  onChange={e => updateRule(rule.id, { strikeStep: parseInt(e.target.value) || 5 })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Priorità</Label>
                <Input
                  type="number"
                  value={rule.priority}
                  onChange={e => updateRule(rule.id, { priority: parseInt(e.target.value) || 1 })}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            {/* Description preview */}
            <p className="text-xs text-muted-foreground italic">{describeRule(rule)}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
