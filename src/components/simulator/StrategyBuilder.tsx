import { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { BacktestLeg, getMonthlyExpiries } from '@/lib/backtestEngine';
import { bsPrice } from '@/lib/blackScholes';
import { IVSurface } from '@/lib/ivSurface';
import { roundStrike } from '@/lib/adjustmentRules';

interface StrategyBuilderProps {
  priceData: { date: string; close: number }[];
  ivSurface: IVSurface;
  riskFreeRate: number;
  dateRange: { from: string; to: string };
  strikeStep: number;
  onLegsChange: (legs: BacktestLeg[], entryDate: string) => void;
}

export function StrategyBuilder({ priceData, ivSurface, riskFreeRate, dateRange, strikeStep, onLegsChange }: StrategyBuilderProps) {
  const [entryDateStr, setEntryDateStr] = useState(dateRange.from);
  const [callDistancePct, setCallDistancePct] = useState(10);
  const [expiryMonth, setExpiryMonth] = useState('');

  const availableExpiries = useMemo(() => {
    return getMonthlyExpiries(dateRange.from, dateRange.to);
  }, [dateRange]);

  const defaultExpiry = useMemo(() => {
    if (availableExpiries.length === 0) return '';
    const entry = new Date(entryDateStr);
    return availableExpiries.find(e => new Date(e) > entry) || availableExpiries[0];
  }, [availableExpiries, entryDateStr]);

  const selectedExpiry = expiryMonth || defaultExpiry;

  const entryPrice = useMemo(() => {
    const bar = priceData.find(p => p.date === entryDateStr);
    if (bar) return bar.close;
    const sorted = [...priceData].sort((a, b) =>
      Math.abs(new Date(a.date).getTime() - new Date(entryDateStr).getTime()) -
      Math.abs(new Date(b.date).getTime() - new Date(entryDateStr).getTime())
    );
    return sorted[0]?.close ?? 0;
  }, [priceData, entryDateStr]);

  const callStrike = useMemo(() => {
    return roundStrike(entryPrice * (1 + callDistancePct / 100), strikeStep);
  }, [entryPrice, callDistancePct, strikeStep]);

  const callPrice = useMemo(() => {
    if (!selectedExpiry || !entryPrice) return 0;
    const T = (new Date(selectedExpiry).getTime() - new Date(entryDateStr).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (T <= 0) return 0;
    const iv = ivSurface.getIV(callStrike, selectedExpiry, 'call');
    return bsPrice(entryPrice, callStrike, T, riskFreeRate, iv, 'call');
  }, [entryPrice, callStrike, selectedExpiry, entryDateStr, ivSurface, riskFreeRate]);

  const totalCost = entryPrice * 100 - callPrice * 100; // 100 shares - 1 call premium

  const computedLegs = useMemo((): BacktestLeg[] => {
    if (!entryPrice || !selectedExpiry) return [];
    return [
      {
        id: 'stock_100',
        type: 'stock' as const,
        strike: 0,
        quantity: 100,
        entryDate: entryDateStr,
        expiryDate: selectedExpiry,
        entryPrice: entryPrice,
        active: true,
      },
      {
        id: 'sold_call',
        type: 'call' as const,
        strike: callStrike,
        quantity: -1,
        entryDate: entryDateStr,
        expiryDate: selectedExpiry,
        entryPrice: callPrice,
        active: true,
      },
    ];
  }, [entryPrice, callStrike, callPrice, entryDateStr, selectedExpiry]);

  const handleApply = useCallback(() => {
    onLegsChange(computedLegs, entryDateStr);
  }, [computedLegs, entryDateStr, onLegsChange]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Covered Call</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 items-end">
          <div className="space-y-1.5">
            <Label>Data Ingresso</Label>
            <Select value={entryDateStr} onValueChange={setEntryDateStr}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-60">
                {priceData.slice(0, 50).map(p => (
                  <SelectItem key={p.date} value={p.date}>{p.date.slice(0, 10)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Prezzo Sottostante</Label>
            <Input value={`$${entryPrice.toFixed(2)}`} disabled />
          </div>
          <div className="space-y-1.5">
            <Label>Distanza Call (%)</Label>
            <Input
              type="number"
              value={callDistancePct}
              onChange={e => setCallDistancePct(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Scadenza</Label>
            <Select value={selectedExpiry} onValueChange={setExpiryMonth}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {availableExpiries.map(e => (
                  <SelectItem key={e} value={e}>{e}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Preview */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">100 Stock @${entryPrice.toFixed(2)}</Badge>
          <Badge variant="destructive">-1 CALL ${callStrike} @${callPrice.toFixed(2)}</Badge>
          <Badge variant="outline">Costo netto: ${totalCost.toFixed(2)}</Badge>
        </div>

        <Button onClick={handleApply} disabled={computedLegs.length === 0}>
          Applica Strategia
        </Button>
      </CardContent>
    </Card>
  );
}
