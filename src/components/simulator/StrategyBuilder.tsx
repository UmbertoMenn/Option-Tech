import { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2 } from 'lucide-react';
import { BacktestLeg, getMonthlyExpiries, thirdFriday } from '@/lib/backtestEngine';
import { bsPrice } from '@/lib/blackScholes';
import { IVSurface } from '@/lib/ivSurface';
import { StrategyPresetType } from '@/lib/adjustmentRules';
import { format } from 'date-fns';

interface StrategyBuilderProps {
  priceData: { date: string; close: number }[];
  ivSurface: IVSurface;
  riskFreeRate: number;
  dateRange: { from: string; to: string };
  onLegsChange: (legs: BacktestLeg[], entryDate: string) => void;
  onStrategyTypeChange: (type: StrategyPresetType) => void;
}

interface LegInput {
  id: string;
  type: 'call' | 'put' | 'stock';
  strikeDistancePct: number; // % from current price (negative = below, positive = above)
  quantity: number;
  expiryMonth: string; // YYYY-MM
}

const PRESETS: { label: string; type: StrategyPresetType; legs: Omit<LegInput, 'id' | 'expiryMonth'>[] }[] = [
  {
    label: 'Iron Condor',
    type: 'iron_condor',
    legs: [
      { type: 'put', strikeDistancePct: -15, quantity: 1 },
      { type: 'put', strikeDistancePct: -10, quantity: -1 },
      { type: 'call', strikeDistancePct: 10, quantity: -1 },
      { type: 'call', strikeDistancePct: 15, quantity: 1 },
    ],
  },
  {
    label: 'Covered Call',
    type: 'covered_call',
    legs: [
      { type: 'stock', strikeDistancePct: 0, quantity: 100 },
      { type: 'call', strikeDistancePct: 10, quantity: -1 },
    ],
  },
  {
    label: 'Cash-Secured Put',
    type: 'cash_secured_put',
    legs: [
      { type: 'put', strikeDistancePct: -10, quantity: -1 },
    ],
  },
  {
    label: 'Bull Call Spread',
    type: 'bull_call_spread',
    legs: [
      { type: 'call', strikeDistancePct: 0, quantity: 1 },
      { type: 'call', strikeDistancePct: 10, quantity: -1 },
    ],
  },
  {
    label: 'Bear Put Spread',
    type: 'bear_put_spread',
    legs: [
      { type: 'put', strikeDistancePct: 0, quantity: -1 },
      { type: 'put', strikeDistancePct: -10, quantity: 1 },
    ],
  },
  {
    label: 'Straddle (Long)',
    type: 'straddle',
    legs: [
      { type: 'call', strikeDistancePct: 0, quantity: 1 },
      { type: 'put', strikeDistancePct: 0, quantity: 1 },
    ],
  },
  {
    label: 'Strangle (Short)',
    type: 'strangle',
    legs: [
      { type: 'put', strikeDistancePct: -10, quantity: -1 },
      { type: 'call', strikeDistancePct: 10, quantity: -1 },
    ],
  },
];

export function StrategyBuilder({ priceData, ivSurface, riskFreeRate, dateRange, onLegsChange, onStrategyTypeChange }: StrategyBuilderProps) {
  const [entryDateStr, setEntryDateStr] = useState(dateRange.from);
  const [legInputs, setLegInputs] = useState<LegInput[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>('');

  const availableExpiries = useMemo(() => {
    return getMonthlyExpiries(dateRange.from, dateRange.to);
  }, [dateRange]);

  const defaultExpiry = useMemo(() => {
    if (availableExpiries.length === 0) return '';
    // Pick first expiry after entry date
    const entry = new Date(entryDateStr);
    return availableExpiries.find(e => new Date(e) > entry) || availableExpiries[0];
  }, [availableExpiries, entryDateStr]);

  const entryPrice = useMemo(() => {
    const bar = priceData.find(p => p.date === entryDateStr);
    if (bar) return bar.close;
    // Find closest
    const sorted = priceData.sort((a, b) => Math.abs(new Date(a.date).getTime() - new Date(entryDateStr).getTime()) - Math.abs(new Date(b.date).getTime() - new Date(entryDateStr).getTime()));
    return sorted[0]?.close ?? 0;
  }, [priceData, entryDateStr]);

  const applyPreset = useCallback((presetIdx: number) => {
    const preset = PRESETS[presetIdx];
    if (!preset) return;
    setSelectedPreset(preset.type);
    onStrategyTypeChange(preset.type);

    const newLegs: LegInput[] = preset.legs.map((l, i) => ({
      id: `leg_${Date.now()}_${i}`,
      type: l.type,
      strikeDistancePct: l.strikeDistancePct,
      quantity: l.quantity,
      expiryMonth: defaultExpiry,
    }));
    setLegInputs(newLegs);
  }, [defaultExpiry, onStrategyTypeChange]);

  const addLeg = useCallback(() => {
    setLegInputs(prev => [...prev, {
      id: `leg_${Date.now()}`,
      type: 'call',
      strikeDistancePct: 10,
      quantity: -1,
      expiryMonth: defaultExpiry,
    }]);
  }, [defaultExpiry]);

  const removeLeg = useCallback((id: string) => {
    setLegInputs(prev => prev.filter(l => l.id !== id));
  }, []);

  const updateLeg = useCallback((id: string, field: keyof LegInput, value: unknown) => {
    setLegInputs(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l));
  }, []);

  // Build actual BacktestLeg objects
  const computedLegs = useMemo((): BacktestLeg[] => {
    if (!entryPrice || legInputs.length === 0) return [];
    
    return legInputs.map(input => {
      const strike = input.type === 'stock' ? 0 : Math.round(entryPrice * (1 + input.strikeDistancePct / 100) * 100) / 100;
      const expiry = input.expiryMonth || defaultExpiry;
      
      let price = 0;
      if (input.type !== 'stock') {
        const T = (new Date(expiry).getTime() - new Date(entryDateStr).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        if (T > 0) {
          const iv = ivSurface.getIV(strike, expiry, input.type);
          price = bsPrice(entryPrice, strike, T, riskFreeRate, iv, input.type);
        }
      } else {
        price = entryPrice;
      }

      return {
        id: input.id,
        type: input.type,
        strike,
        quantity: input.quantity,
        entryDate: entryDateStr,
        expiryDate: expiry,
        entryPrice: price,
        active: true,
      };
    });
  }, [legInputs, entryPrice, entryDateStr, ivSurface, riskFreeRate, defaultExpiry]);

  // Notify parent
  const handleApply = useCallback(() => {
    onLegsChange(computedLegs, entryDateStr);
  }, [computedLegs, entryDateStr, onLegsChange]);

  const totalCost = computedLegs.reduce((acc, l) => {
    const mult = l.type === 'stock' ? 1 : 100;
    return acc + l.entryPrice * l.quantity * mult;
  }, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Strategia</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Entry date + price */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 items-end">
          <div className="space-y-1.5">
            <Label>Data Ingresso</Label>
            <Select value={entryDateStr} onValueChange={setEntryDateStr}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-60">
                {priceData.slice(0, 50).map(p => (
                  <SelectItem key={p.date} value={p.date}>{p.date}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Prezzo Sottostante</Label>
            <Input value={`$${entryPrice.toFixed(2)}`} disabled />
          </div>
          <div className="space-y-1.5">
            <Label>Risk-Free Rate</Label>
            <Input value={`${(riskFreeRate * 100).toFixed(2)}%`} disabled />
          </div>
          <div className="space-y-1.5">
            <Label>Costo Apertura</Label>
            <Input value={`$${totalCost.toFixed(2)}`} disabled className={totalCost < 0 ? 'text-green-500' : 'text-red-500'} />
          </div>
        </div>

        {/* Presets */}
        <div>
          <Label className="mb-2 block">Preset</Label>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p, i) => (
              <Button
                key={p.type}
                variant={selectedPreset === p.type ? 'default' : 'outline'}
                size="sm"
                onClick={() => applyPreset(i)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Legs table */}
        {legInputs.length > 0 && (
          <div className="space-y-2">
            <Label>Gambe</Label>
            <div className="space-y-2">
              {legInputs.map(leg => (
                <div key={leg.id} className="grid grid-cols-5 gap-2 items-center">
                  <Select value={leg.type} onValueChange={v => updateLeg(leg.id, 'type', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="call">Call</SelectItem>
                      <SelectItem value="put">Put</SelectItem>
                      <SelectItem value="stock">Stock</SelectItem>
                    </SelectContent>
                  </Select>

                  {leg.type !== 'stock' ? (
                    <>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          value={leg.strikeDistancePct}
                          onChange={e => updateLeg(leg.id, 'strikeDistancePct', parseFloat(e.target.value) || 0)}
                          className="w-20"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                      <Select value={leg.expiryMonth} onValueChange={v => updateLeg(leg.id, 'expiryMonth', v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {availableExpiries.map(e => (
                            <SelectItem key={e} value={e}>{e}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  ) : (
                    <div className="col-span-2" />
                  )}

                  <Input
                    type="number"
                    value={leg.quantity}
                    onChange={e => updateLeg(leg.id, 'quantity', parseInt(e.target.value) || 0)}
                    className="w-20"
                  />

                  <Button variant="ghost" size="icon" onClick={() => removeLeg(leg.id)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Computed strikes preview */}
            <div className="flex flex-wrap gap-2 mt-2">
              {computedLegs.filter(l => l.type !== 'stock').map(l => (
                <Badge key={l.id} variant={l.quantity < 0 ? 'destructive' : 'default'}>
                  {l.quantity > 0 ? '+' : ''}{l.quantity} {l.type.toUpperCase()} ${l.strike.toFixed(0)} @${l.entryPrice.toFixed(2)}
                </Badge>
              ))}
              {computedLegs.filter(l => l.type === 'stock').map(l => (
                <Badge key={l.id} variant="secondary">
                  {l.quantity} Stock @${l.entryPrice.toFixed(2)}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addLeg}>
            <Plus className="w-4 h-4 mr-1" /> Aggiungi Gamba
          </Button>
          <Button onClick={handleApply} disabled={computedLegs.length === 0}>
            Applica Strategia
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
