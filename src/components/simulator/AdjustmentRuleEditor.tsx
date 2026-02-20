import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { CoveredCallRules } from '@/lib/adjustmentRules';
import { Separator } from '@/components/ui/separator';

interface AdjustmentRuleEditorProps {
  rules: CoveredCallRules;
  onRulesChange: (rules: CoveredCallRules) => void;
}

export function AdjustmentRuleEditor({ rules, onRulesChange }: AdjustmentRuleEditorProps) {
  const update = (patch: Partial<CoveredCallRules>) => onRulesChange({ ...rules, ...patch });
  const updateApproach = (patch: Partial<CoveredCallRules['approachRule']>) =>
    update({ approachRule: { ...rules.approachRule, ...patch } });
  const updateProfit = (patch: Partial<CoveredCallRules['profitRule']>) =>
    update({ profitRule: { ...rules.profitRule, ...patch } });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Regole di Aggiustamento</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Global strike step */}
        <div className="flex items-center gap-3">
          <Label className="whitespace-nowrap">Incremento Strike</Label>
          <Input
            type="number"
            value={rules.strikeStep}
            onChange={e => update({ strikeStep: parseInt(e.target.value) || 5 })}
            className="w-20 h-8"
          />
        </div>

        <Separator />

        {/* ── RULE 1: Price approaches sold call ── */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">📈 Se il prezzo si avvicina alla call venduta</h3>
            <Switch
              checked={rules.approachRule.enabled}
              onCheckedChange={v => updateApproach({ enabled: v })}
            />
          </div>

          {rules.approachRule.enabled && (
            <div className="pl-4 border-l-2 border-primary/20 space-y-4">
              <div className="flex items-center gap-2">
                <Label className="text-xs whitespace-nowrap">Distanza di attivazione</Label>
                <Input
                  type="number"
                  value={rules.approachRule.activationPct}
                  onChange={e => updateApproach({ activationPct: parseFloat(e.target.value) || 2 })}
                  className="w-16 h-8 text-xs"
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>

              <div>
                <Label className="text-xs mb-2 block">Cosa fai?</Label>
                <RadioGroup
                  value={rules.approachRule.action}
                  onValueChange={v => updateApproach({ action: v as CoveredCallRules['approachRule']['action'] })}
                  className="space-y-3"
                >
                  <div className="flex items-start gap-2">
                    <RadioGroupItem value="roll_up_always" id="approach_a" className="mt-1" />
                    <Label htmlFor="approach_a" className="text-xs leading-relaxed cursor-pointer">
                      Rollo su scadenza successiva con strike più alto (anche se il nuovo premio è inferiore al costo di riacquisto)
                    </Label>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <RadioGroupItem value="roll_up_positive" id="approach_b" className="mt-1" />
                      <Label htmlFor="approach_b" className="text-xs leading-relaxed cursor-pointer">
                        Rollo su scadenza successiva con strike più alto, solo se la differenza è positiva di almeno:
                      </Label>
                    </div>
                    {rules.approachRule.action === 'roll_up_positive' && (
                      <div className="pl-6 flex gap-3">
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            value={rules.approachRule.minPremiumUsd}
                            onChange={e => updateApproach({ minPremiumUsd: parseFloat(e.target.value) || 0 })}
                            className="w-16 h-7 text-xs"
                          />
                          <span className="text-xs">USD</span>
                        </div>
                        <span className="text-xs text-muted-foreground self-center">oppure</span>
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            value={rules.approachRule.minPremiumPct}
                            onChange={e => updateApproach({ minPremiumPct: parseFloat(e.target.value) || 0 })}
                            className="w-16 h-7 text-xs"
                          />
                          <span className="text-xs">% del sottostante</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <RadioGroupItem value="do_nothing" id="approach_c" className="mt-1" />
                      <Label htmlFor="approach_c" className="text-xs leading-relaxed cursor-pointer">
                        Non faccio nulla. Alla scadenza:
                      </Label>
                    </div>
                    {rules.approachRule.action === 'do_nothing' && (
                      <div className="pl-6 space-y-2">
                        <RadioGroup
                          value={rules.approachRule.expiryAction}
                          onValueChange={v => updateApproach({ expiryAction: v as 'sell_new_call' | 'rebuy_and_sell' })}
                          className="space-y-2"
                        >
                          <div className="flex items-start gap-2">
                            <RadioGroupItem value="sell_new_call" id="expiry_otm" className="mt-0.5" />
                            <Label htmlFor="expiry_otm" className="text-xs cursor-pointer">
                              Se OTM, vendo altra call con barriera
                            </Label>
                          </div>
                          <div className="flex items-start gap-2">
                            <RadioGroupItem value="rebuy_and_sell" id="expiry_itm" className="mt-0.5" />
                            <Label htmlFor="expiry_itm" className="text-xs cursor-pointer">
                              Se ITM, ricompro titoli e vendo altra call con barriera
                            </Label>
                          </div>
                        </RadioGroup>
                        <div className="flex items-center gap-1">
                          <Label className="text-xs whitespace-nowrap">Barriera nuova call</Label>
                          <Input
                            type="number"
                            value={rules.approachRule.newCallBarrierPct}
                            onChange={e => updateApproach({ newCallBarrierPct: parseFloat(e.target.value) || 5 })}
                            className="w-16 h-7 text-xs"
                          />
                          <span className="text-xs">%</span>
                        </div>
                      </div>
                    )}
                  </div>
                </RadioGroup>
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* ── RULE 2: Option in profit ── */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">💰 Se l'opzione venduta sta guadagnando</h3>
            <Switch
              checked={rules.profitRule.enabled}
              onCheckedChange={v => updateProfit({ enabled: v })}
            />
          </div>

          {rules.profitRule.enabled && (
            <div className="pl-4 border-l-2 border-primary/20 space-y-4">
              <div className="flex items-center gap-2">
                <Label className="text-xs whitespace-nowrap">Soglia di guadagno</Label>
                <Input
                  type="number"
                  value={rules.profitRule.profitPct}
                  onChange={e => updateProfit({ profitPct: parseFloat(e.target.value) || 80 })}
                  className="w-16 h-8 text-xs"
                />
                <span className="text-xs text-muted-foreground">% (l'opzione ha perso X% del valore)</span>
              </div>

              <div>
                <Label className="text-xs mb-2 block">Cosa fai?</Label>
                <RadioGroup
                  value={rules.profitRule.action}
                  onValueChange={v => updateProfit({ action: v as CoveredCallRules['profitRule']['action'] })}
                  className="space-y-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <RadioGroupItem value="wait_and_sell" id="profit_a" className="mt-1" />
                      <Label htmlFor="profit_a" className="text-xs leading-relaxed cursor-pointer">
                        Aspetto che scada e rivendo call con barriera:
                      </Label>
                    </div>
                    {rules.profitRule.action === 'wait_and_sell' && (
                      <div className="pl-6 flex items-center gap-1">
                        <Input
                          type="number"
                          value={rules.profitRule.newCallBarrierPct}
                          onChange={e => updateProfit({ newCallBarrierPct: parseFloat(e.target.value) || 5 })}
                          className="w-16 h-7 text-xs"
                        />
                        <span className="text-xs">%</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <RadioGroupItem value="roll_down_first_expiry" id="profit_b" className="mt-1" />
                      <Label htmlFor="profit_b" className="text-xs leading-relaxed cursor-pointer">
                        Se sulla prima scadenza disponibile, rollo su strike più basso con stessa scadenza, se il nuovo premio è maggiore di almeno:
                      </Label>
                    </div>
                    {rules.profitRule.action === 'roll_down_first_expiry' && (
                      <div className="pl-6 flex gap-3">
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            value={rules.profitRule.minPremiumUsd}
                            onChange={e => updateProfit({ minPremiumUsd: parseFloat(e.target.value) || 0 })}
                            className="w-16 h-7 text-xs"
                          />
                          <span className="text-xs">USD</span>
                        </div>
                        <span className="text-xs text-muted-foreground self-center">oppure</span>
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            value={rules.profitRule.minPremiumPct}
                            onChange={e => updateProfit({ minPremiumPct: parseFloat(e.target.value) || 0 })}
                            className="w-16 h-7 text-xs"
                          />
                          <span className="text-xs">% del sottostante</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <RadioGroupItem value="roll_down_any_expiry" id="profit_c" className="mt-1" />
                      <Label htmlFor="profit_c" className="text-xs leading-relaxed cursor-pointer">
                        Se su scadenze successive, cerco opzione con strike lontano almeno X% dal sottostante, scadenza minima, premio non inferiore a:
                      </Label>
                    </div>
                    {rules.profitRule.action === 'roll_down_any_expiry' && (
                      <div className="pl-6 space-y-2">
                        <div className="flex items-center gap-1">
                          <Label className="text-xs whitespace-nowrap">Distanza min strike</Label>
                          <Input
                            type="number"
                            value={rules.profitRule.minDistancePct}
                            onChange={e => updateProfit({ minDistancePct: parseFloat(e.target.value) || 5 })}
                            className="w-16 h-7 text-xs"
                          />
                          <span className="text-xs">%</span>
                        </div>
                        <div className="flex gap-3">
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              value={rules.profitRule.rollDownMinPremiumUsd}
                              onChange={e => updateProfit({ rollDownMinPremiumUsd: parseFloat(e.target.value) || 0 })}
                              className="w-16 h-7 text-xs"
                            />
                            <span className="text-xs">USD</span>
                          </div>
                          <span className="text-xs text-muted-foreground self-center">oppure</span>
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              value={rules.profitRule.rollDownMinPremiumPct}
                              onChange={e => updateProfit({ rollDownMinPremiumPct: parseFloat(e.target.value) || 0 })}
                              className="w-16 h-7 text-xs"
                            />
                            <span className="text-xs">% del riacquisto</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </RadioGroup>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
