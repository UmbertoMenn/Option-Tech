import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { AdjustmentRule, AdjustmentCondition, AdjustmentAction, getPresetRules, describeRule, StrategyPresetType } from '@/lib/adjustmentRules';

interface AdjustmentRuleEditorProps {
  rules: AdjustmentRule[];
  onRulesChange: (rules: AdjustmentRule[]) => void;
  strategyType: StrategyPresetType;
}

export function AdjustmentRuleEditor({ rules, onRulesChange, strategyType }: AdjustmentRuleEditorProps) {
  const loadPreset = useCallback(() => {
    const preset = getPresetRules(strategyType);
    onRulesChange(preset);
  }, [strategyType, onRulesChange]);

  const addCustomRule = useCallback(() => {
    const newRule: AdjustmentRule = {
      id: `custom_${Date.now()}`,
      name: 'Nuova regola',
      condition: { type: 'pl_threshold', plPct: -30 },
      action: { type: 'close_all' },
      priority: rules.length + 1,
      maxTriggers: 1,
      cooldownDays: 0,
    };
    onRulesChange([...rules, newRule]);
  }, [rules, onRulesChange]);

  const removeRule = useCallback((id: string) => {
    onRulesChange(rules.filter(r => r.id !== id));
  }, [rules, onRulesChange]);

  const updateRule = useCallback((id: string, updates: Partial<AdjustmentRule>) => {
    onRulesChange(rules.map(r => r.id === id ? { ...r, ...updates } : r));
  }, [rules, onRulesChange]);

  const updateCondition = useCallback((id: string, condUpdates: Partial<AdjustmentCondition>) => {
    onRulesChange(rules.map(r => r.id === id ? { ...r, condition: { ...r.condition, ...condUpdates } } : r));
  }, [rules, onRulesChange]);

  const updateAction = useCallback((id: string, actUpdates: Partial<AdjustmentAction>) => {
    onRulesChange(rules.map(r => r.id === id ? { ...r, action: { ...r.action, ...actUpdates } } : r));
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
                <Select value={rule.condition.type} onValueChange={v => updateCondition(rule.id, { type: v as AdjustmentCondition['type'] })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="price_near_barrier">Prezzo vicino a barriera</SelectItem>
                    <SelectItem value="delta_threshold">Soglia Delta</SelectItem>
                    <SelectItem value="days_to_expiry">Giorni a scadenza</SelectItem>
                    <SelectItem value="pl_threshold">Soglia P/L</SelectItem>
                  </SelectContent>
                </Select>

                {rule.condition.type === 'price_near_barrier' && (
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={rule.condition.legType || 'sold_put'} onValueChange={v => updateCondition(rule.id, { legType: v as AdjustmentCondition['legType'] })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sold_put">Put venduta</SelectItem>
                        <SelectItem value="sold_call">Call venduta</SelectItem>
                        <SelectItem value="bought_put">Put comprata</SelectItem>
                        <SelectItem value="bought_call">Call comprata</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-1">
                      <Input type="number" value={rule.condition.distancePct ?? 5} onChange={e => updateCondition(rule.id, { distancePct: parseFloat(e.target.value) || 5 })} className="h-8 text-xs w-16" />
                      <span className="text-xs">%</span>
                    </div>
                  </div>
                )}

                {rule.condition.type === 'days_to_expiry' && (
                  <div className="flex items-center gap-1">
                    <Input type="number" value={rule.condition.maxDays ?? 5} onChange={e => updateCondition(rule.id, { maxDays: parseInt(e.target.value) || 5 })} className="h-8 text-xs w-16" />
                    <span className="text-xs">DTE</span>
                  </div>
                )}

                {rule.condition.type === 'pl_threshold' && (
                  <div className="flex items-center gap-1">
                    <Input type="number" value={rule.condition.plPct ?? -30} onChange={e => updateCondition(rule.id, { plPct: parseFloat(e.target.value) || 0 })} className="h-8 text-xs w-20" />
                    <span className="text-xs">%</span>
                  </div>
                )}
              </div>

              {/* Action */}
              <div className="space-y-2">
                <Label className="text-xs">Azione</Label>
                <Select value={rule.action.type} onValueChange={v => updateAction(rule.id, { type: v as AdjustmentAction['type'] })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="roll_strike">Rolla strike</SelectItem>
                    <SelectItem value="roll_expiry">Rolla scadenza</SelectItem>
                    <SelectItem value="close_all">Chiudi tutto</SelectItem>
                    <SelectItem value="close_leg">Chiudi gamba</SelectItem>
                  </SelectContent>
                </Select>

                {rule.action.type === 'roll_strike' && (
                  <div className="flex items-center gap-1">
                    <Input type="number" value={rule.action.rollDistancePct ?? -10} onChange={e => updateAction(rule.id, { rollDistancePct: parseFloat(e.target.value) || 0 })} className="h-8 text-xs w-20" />
                    <span className="text-xs">%</span>
                  </div>
                )}

                {rule.action.type === 'roll_expiry' && (
                  <div className="flex items-center gap-1">
                    <Input type="number" value={rule.action.rollMonths ?? 1} onChange={e => updateAction(rule.id, { rollMonths: parseInt(e.target.value) || 1 })} className="h-8 text-xs w-16" />
                    <span className="text-xs">mesi</span>
                  </div>
                )}
              </div>
            </div>

            {/* Parameters */}
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Max trigger</Label>
                <Input type="number" value={rule.maxTriggers} onChange={e => updateRule(rule.id, { maxTriggers: parseInt(e.target.value) || 0 })} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cooldown (gg)</Label>
                <Input type="number" value={rule.cooldownDays} onChange={e => updateRule(rule.id, { cooldownDays: parseInt(e.target.value) || 0 })} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Priorità</Label>
                <Input type="number" value={rule.priority} onChange={e => updateRule(rule.id, { priority: parseInt(e.target.value) || 1 })} className="h-8 text-xs" />
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
