import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
            onChange={e => update({ strikeStep: e.target.value === '' ? 0 : parseInt(e.target.value) })}
            className="w-20 h-8"
          />
        </div>

        <Separator />

        {/* ── RULE 1: Price approaches sold call ── */}
        <div className="space-y-4">
          <h3 className="font-semibold text-sm">📈 Se il prezzo si avvicina alla call venduta</h3>
          <p className="text-xs text-muted-foreground">
            Rollo sulla prima scadenza successiva con strike più alto, solo se il premio netto aggiuntivo è almeno la percentuale indicata rispetto al prezzo del sottostante.
          </p>

          <div className="pl-4 border-l-2 border-primary/20 space-y-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">Distanza di attivazione</Label>
              <Input
                type="number"
                value={rules.approachRule.activationPct}
                onChange={e => updateApproach({ activationPct: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                className="w-16 h-8 text-xs"
              />
              <span className="text-xs text-muted-foreground">%</span>
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">Distanza min strike</Label>
              <Input
                type="number"
                value={rules.approachRule.rollUpMinDistancePct}
                onChange={e => updateApproach({ rollUpMinDistancePct: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                className="w-16 h-8 text-xs"
              />
              <span className="text-xs text-muted-foreground">%</span>
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">Premio minimo aggiuntivo</Label>
              <Input
                type="number"
                value={rules.approachRule.minPremiumPct}
                onChange={e => updateApproach({ minPremiumPct: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                className="w-16 h-8 text-xs"
                step="0.1"
              />
              <span className="text-xs text-muted-foreground">% del sottostante</span>
            </div>
          </div>
        </div>

        <Separator />

        {/* ── RULE 2: Option in profit ── */}
        <div className="space-y-4">
          <h3 className="font-semibold text-sm">💰 Se l'opzione venduta sta guadagnando</h3>

          <div className="pl-4 border-l-2 border-primary/20 space-y-4">
            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">Soglia di guadagno</Label>
              <Input
                type="number"
                value={rules.profitRule.profitPct}
                onChange={e => updateProfit({ profitPct: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                className="w-16 h-8 text-xs"
              />
              <span className="text-xs text-muted-foreground">% (l'opzione ha perso X% del valore)</span>
            </div>

            {/* Shared: first expiry params */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Sulla prima scadenza disponibile, rollo su strike più basso con stessa scadenza, se:
              </p>
              <div className="flex items-center gap-1">
                <Label className="text-xs whitespace-nowrap">Distanza min strike</Label>
                <Input
                  type="number"
                  value={rules.profitRule.firstExpiryMinDistancePct}
                  onChange={e => updateProfit({ firstExpiryMinDistancePct: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                  className="w-16 h-7 text-xs"
                />
                <span className="text-xs">%</span>
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs whitespace-nowrap">Premio minimo</Label>
                <Input
                  type="number"
                  value={rules.profitRule.firstExpiryMinPremiumPct}
                  onChange={e => updateProfit({ firstExpiryMinPremiumPct: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                  className="w-16 h-7 text-xs"
                  step="0.1"
                />
                <span className="text-xs">% del sottostante</span>
              </div>
            </div>

            <Separator />

            <div>
              <Label className="text-xs mb-2 block">Su scadenze successive, cosa fai?</Label>
              <RadioGroup
                value={rules.profitRule.action}
                onValueChange={v => updateProfit({ action: v as 'dynamic' | 'static' })}
                className="space-y-3"
              >
                {/* Rolling Dinamico */}
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <RadioGroupItem value="dynamic" id="profit_dynamic" className="mt-1" />
                    <Label htmlFor="profit_dynamic" className="text-xs leading-relaxed cursor-pointer">
                      Rolling Dinamico
                    </Label>
                  </div>
                  {rules.profitRule.action === 'dynamic' && (
                    <div className="pl-6 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Se l'opzione sta guadagnando più della soglia e i premi netti annualizzati (max 1 anno di lookback) superano la soglia, rollo indietro sulla prima scadenza disponibile, anche in perdita.
                      </p>
                      <div className="flex items-center gap-1">
                        <Label className="text-xs whitespace-nowrap">Premi annualizzati min</Label>
                        <Input
                          type="number"
                          value={rules.profitRule.dynamicAnnualizedPremiumPct}
                          onChange={e => updateProfit({ dynamicAnnualizedPremiumPct: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                          className="w-16 h-7 text-xs"
                          step="0.5"
                        />
                        <span className="text-xs">%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="text-xs whitespace-nowrap">Distanza min strike</Label>
                        <Input
                          type="number"
                          value={rules.profitRule.dynamicMinDistancePct}
                          onChange={e => updateProfit({ dynamicMinDistancePct: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                          className="w-16 h-7 text-xs"
                        />
                        <span className="text-xs">%</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Rolling Statico */}
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <RadioGroupItem value="static" id="profit_static" className="mt-1" />
                    <Label htmlFor="profit_static" className="text-xs leading-relaxed cursor-pointer">
                      Rolling Statico
                    </Label>
                  </div>
                  {rules.profitRule.action === 'static' && (
                    <div className="pl-6 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Rollo indietro sulla prima scadenza disponibile con distanza minima e premio netto positivo.
                      </p>
                      <div className="flex items-center gap-1">
                        <Label className="text-xs whitespace-nowrap">Distanza min strike</Label>
                        <Input
                          type="number"
                          value={rules.profitRule.staticMinDistancePct}
                          onChange={e => updateProfit({ staticMinDistancePct: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                          className="w-16 h-7 text-xs"
                        />
                        <span className="text-xs">%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="text-xs whitespace-nowrap">Premio netto min</Label>
                        <Input
                          type="number"
                          value={rules.profitRule.staticMinPremiumPct}
                          onChange={e => updateProfit({ staticMinPremiumPct: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                          className="w-16 h-7 text-xs"
                          step="0.1"
                        />
                        <span className="text-xs">% del sottostante</span>
                      </div>
                    </div>
                  )}
                </div>
              </RadioGroup>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
