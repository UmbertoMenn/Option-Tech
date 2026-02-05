import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, Loader2, AlertTriangle, Check } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { 
  useAlertConfigs, 
  useBatchUpsertAlertConfigs,
  useDeleteAlertConfig,
  useInitializeDefaultConfigs,
} from '@/hooks/useAlertConfigs';
import {
  AlertType,
  ALERT_TYPE_LABELS,
  DISTANCE_ALERT_TYPES,
  ACTION_ALERT_TYPES,
  LEAP_GAIN_ALERT_TYPES,
  GROUPED_DISTANCE_ALERTS,
  DEFAULT_DISTANCE_THRESHOLD_PCT,
  DEFAULT_COOLDOWN_MINUTES,
} from '@/types/alerts';
import { DerivativeCategories } from '@/lib/derivativeStrategies';
import { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';

interface AlertSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: DerivativeCategories;
  underlyingPrices: Record<string, UnderlyingPrice>;
}

// Extract unique tickers from all strategy categories
// Uses underlyingPrices directly since it already contains resolved tickers
function extractUniqueTickers(
  categories: DerivativeCategories,
  underlyingPrices: Record<string, UnderlyingPrice>
): { 
  resolved: Array<{ underlying: string; ticker: string }>;
  unresolved: string[];
} {
  // 1. Collect ALL underlyings from strategy categories
  const allCategoryUnderlyings = new Set<string>();
  
  categories.ironCondors.forEach(ic => allCategoryUnderlyings.add(ic.underlying));
  categories.doubleDiagonals.forEach(dd => allCategoryUnderlyings.add(dd.underlying));
  categories.coveredCalls.forEach(cc => {
    const u = cc.option.underlying || cc.underlying?.description;
    if (u) allCategoryUnderlyings.add(u);
  });
  categories.nakedPuts.forEach(np => {
    const u = np.option.underlying;
    if (u) allCategoryUnderlyings.add(u);
  });
  categories.leapCalls.forEach(lc => {
    const u = lc.option.underlying;
    if (u) allCategoryUnderlyings.add(u);
  });
  categories.groupedOtherStrategies.forEach(g => allCategoryUnderlyings.add(g.underlying));
  
  // 2. Use underlyingPrices DIRECTLY for resolved tickers
  //    (keys are original underlyings, values contain .ticker)
  const resolvedTickersSet = new Set<string>();
  const resolved: Array<{ underlying: string; ticker: string }> = [];
  
  for (const [underlying, priceData] of Object.entries(underlyingPrices)) {
    if (priceData.ticker && !resolvedTickersSet.has(priceData.ticker)) {
      resolvedTickersSet.add(priceData.ticker);
      resolved.push({ underlying, ticker: priceData.ticker });
    }
  }
  
  // 3. Find unresolved underlyings
  //    (those in categories but without an entry in underlyingPrices)
  const resolvedUnderlyings = new Set(Object.keys(underlyingPrices));
  const unresolved: string[] = [];
  
  for (const underlying of allCategoryUnderlyings) {
    if (!underlying) continue;
    
    // Check if there's a matching key (exact or partial match)
    let found = false;
    for (const priceKey of resolvedUnderlyings) {
      if (priceKey === underlying || 
          priceKey.includes(underlying) || 
          underlying.includes(priceKey)) {
        found = true;
        break;
      }
    }
    
    if (!found) {
      unresolved.push(underlying);
    }
  }
  
  return { 
    resolved: resolved.sort((a, b) => a.ticker.localeCompare(b.ticker)),
    unresolved: [...new Set(unresolved)].sort()
  };
}

export function AlertSettingsDialog({ open, onOpenChange, categories, underlyingPrices }: AlertSettingsDialogProps) {
  const { data: configs = [], isLoading } = useAlertConfigs();
  const batchUpsertMutation = useBatchUpsertAlertConfigs();
  const deleteConfigMutation = useDeleteAlertConfig();
  const initializeDefaultsMutation = useInitializeDefaultConfigs();
  
  // Local state for editing
  const [globalThresholds, setGlobalThresholds] = useState<Record<AlertType, number>>({} as Record<AlertType, number>);
  const [actionToggles, setActionToggles] = useState<Record<AlertType, boolean>>({} as Record<AlertType, boolean>);
  const [cooldownMinutes, setCooldownMinutes] = useState(DEFAULT_COOLDOWN_MINUTES);
  const [tickerOverrides, setTickerOverrides] = useState<Array<{ ticker: string; alertTypes: AlertType[]; threshold: number }>>([]);
  const [newTicker, setNewTicker] = useState('');
  
  // State for unresolved ticker mappings
  const [unresolvedMappings, setUnresolvedMappings] = useState<Record<string, string>>({});
  const [savingMapping, setSavingMapping] = useState<string | null>(null);
  
  // Extract available tickers from strategies
  const { resolved: availableTickers, unresolved: unresolvedUnderlyings } = useMemo(() => 
    extractUniqueTickers(categories, underlyingPrices),
    [categories, underlyingPrices]
  );
  
  // Initialize local state from configs
  useEffect(() => {
    if (configs.length === 0 && !isLoading) {
      // Initialize default configs if none exist
      initializeDefaultsMutation.mutate();
      return;
    }
    
    // Set global thresholds
    const thresholds: Record<AlertType, number> = {} as Record<AlertType, number>;
    DISTANCE_ALERT_TYPES.forEach(type => {
      const config = configs.find(c => c.alert_type === type && c.ticker === null);
      thresholds[type] = config?.threshold_pct ?? DEFAULT_DISTANCE_THRESHOLD_PCT;
    });
    setGlobalThresholds(thresholds);
    
    // Set action toggles
    const toggles: Record<AlertType, boolean> = {} as Record<AlertType, boolean>;
    [...ACTION_ALERT_TYPES, ...LEAP_GAIN_ALERT_TYPES].forEach(type => {
      const config = configs.find(c => c.alert_type === type && c.ticker === null);
      toggles[type] = config?.enabled ?? true;
    });
    setActionToggles(toggles);
    
    // Set cooldown (use first found cooldown as global)
    const anyConfig = configs.find(c => c.ticker === null);
    setCooldownMinutes(anyConfig?.cooldown_minutes ?? DEFAULT_COOLDOWN_MINUTES);
    
    // Set ticker overrides
    const tickerConfigs = configs.filter(c => c.ticker !== null);
    const tickerMap = new Map<string, { alertTypes: AlertType[]; threshold: number }>();
    
    tickerConfigs.forEach(tc => {
      if (!tc.ticker) return;
      const existing = tickerMap.get(tc.ticker);
      if (existing) {
        existing.alertTypes.push(tc.alert_type);
      } else {
        tickerMap.set(tc.ticker, {
          alertTypes: [tc.alert_type],
          threshold: tc.threshold_pct,
        });
      }
    });
    
    setTickerOverrides(
      Array.from(tickerMap.entries()).map(([ticker, data]) => ({
        ticker,
        alertTypes: data.alertTypes,
        threshold: data.threshold,
      }))
    );
  }, [configs, isLoading]);
  
  // Handle save
  const handleSave = async () => {
    try {
      const configsToUpsert: Array<{
        alert_type: AlertType;
        ticker?: string | null;
        threshold_pct?: number;
        cooldown_minutes?: number;
        enabled?: boolean;
      }> = [];
      
      // Global distance thresholds
      DISTANCE_ALERT_TYPES.forEach(type => {
        configsToUpsert.push({
          alert_type: type,
          ticker: null,
          threshold_pct: globalThresholds[type] ?? DEFAULT_DISTANCE_THRESHOLD_PCT,
          cooldown_minutes: cooldownMinutes,
          enabled: true,
        });
      });
      
      // Action toggles
      [...ACTION_ALERT_TYPES, ...LEAP_GAIN_ALERT_TYPES].forEach(type => {
        configsToUpsert.push({
          alert_type: type,
          ticker: null,
          threshold_pct: 0,
          cooldown_minutes: cooldownMinutes,
          enabled: actionToggles[type] ?? true,
        });
      });
      
      // Ticker overrides
      tickerOverrides.forEach(override => {
        DISTANCE_ALERT_TYPES.forEach(type => {
          configsToUpsert.push({
            alert_type: type,
            ticker: override.ticker.toUpperCase(),
            threshold_pct: override.threshold,
            cooldown_minutes: cooldownMinutes,
            enabled: true,
          });
        });
      });
      
      await batchUpsertMutation.mutateAsync(configsToUpsert);
      toast.success('Impostazioni avvisi salvate');
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving alert configs:', error);
      toast.error('Errore nel salvataggio delle impostazioni');
    }
  };
  
  // Add ticker from available list
  const handleAddTickerFromList = (ticker: string) => {
    if (tickerOverrides.some(t => t.ticker === ticker)) {
      toast.error('Ticker già presente negli override');
      return;
    }
    
    setTickerOverrides([
      ...tickerOverrides,
      { ticker, alertTypes: [...DISTANCE_ALERT_TYPES], threshold: DEFAULT_DISTANCE_THRESHOLD_PCT }
    ]);
    toast.success(`${ticker} aggiunto agli override`);
  };
  
  // Add ticker manually
  const handleAddTicker = () => {
    const ticker = newTicker.trim().toUpperCase();
    if (!ticker) return;
    
    if (tickerOverrides.some(t => t.ticker === ticker)) {
      toast.error('Ticker già presente');
      return;
    }
    
    setTickerOverrides([
      ...tickerOverrides,
      { ticker, alertTypes: [...DISTANCE_ALERT_TYPES], threshold: DEFAULT_DISTANCE_THRESHOLD_PCT }
    ]);
    setNewTicker('');
  };
  
  // Remove ticker override
  const handleRemoveTicker = async (ticker: string) => {
    setTickerOverrides(tickerOverrides.filter(t => t.ticker !== ticker));
    
    // Delete from database for all alert types
    for (const alertType of DISTANCE_ALERT_TYPES) {
      try {
        await deleteConfigMutation.mutateAsync({ alert_type: alertType, ticker });
      } catch {
        // Ignore errors for non-existent configs
      }
    }
  };
  
  // Update ticker threshold
  const handleTickerThresholdChange = (ticker: string, threshold: number) => {
    setTickerOverrides(
      tickerOverrides.map(t => 
        t.ticker === ticker ? { ...t, threshold } : t
      )
    );
  };
  
  // Save ticker mapping for unresolved underlying
  const handleSaveUnresolvedMapping = async (underlying: string) => {
    const ticker = unresolvedMappings[underlying]?.trim().toUpperCase();
    if (!ticker) {
      toast.error('Inserisci un ticker valido');
      return;
    }
    
    setSavingMapping(underlying);
    
    try {
      // Save to underlying_mappings table
      const { error } = await supabase
        .from('underlying_mappings')
        .upsert({
          underlying,
          ticker,
          source: 'manual-alert-config',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'underlying' });
      
      if (error) throw error;
      
      toast.success(`Mapping salvato: ${underlying} → ${ticker}`);
      
      // Remove from unresolved mappings state
      setUnresolvedMappings(prev => {
        const updated = { ...prev };
        delete updated[underlying];
        return updated;
      });
      
      // Note: The underlying will still show as unresolved until the next fetch
      // because underlyingPrices is passed from the parent component
    } catch (error) {
      console.error('Error saving ticker mapping:', error);
      toast.error('Errore nel salvataggio del mapping');
    } finally {
      setSavingMapping(null);
    }
  };
  
  // Format cooldown for display
  const formatCooldown = (minutes: number) => {
    if (minutes < 60) return `${minutes} min`;
    const hours = minutes / 60;
    return hours === 1 ? '1 ora' : `${hours} ore`;
  };
  
  const isSaving = batchUpsertMutation.isPending;
  
  // Check if a ticker is already in overrides
  const isTickerInOverrides = (ticker: string) => 
    tickerOverrides.some(t => t.ticker === ticker);
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gestione Avvisi</DialogTitle>
          <DialogDescription>
            Configura le soglie e le notifiche per le strategie derivate
          </DialogDescription>
        </DialogHeader>
        
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="distance" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="distance">Distanza</TabsTrigger>
              <TabsTrigger value="ticker">Per Ticker</TabsTrigger>
              <TabsTrigger value="action">Azione</TabsTrigger>
              <TabsTrigger value="cooldown">Cooldown</TabsTrigger>
            </TabsList>
            
            {/* Tab 1: Global Distance Thresholds */}
            <TabsContent value="distance" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground mb-4">
                Soglie globali per gli avvisi di distanza dallo strike. Valori più bassi = avvisi più tempestivi.
              </p>
              
              {GROUPED_DISTANCE_ALERTS.map(group => (
                <div key={group.label} className="space-y-3 p-4 border rounded-lg">
                  <h4 className="font-medium">{group.label}</h4>
                  
                  {group.callType && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm">Lato Call (prezzo sale)</Label>
                        <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
                          {globalThresholds[group.callType] ?? DEFAULT_DISTANCE_THRESHOLD_PCT}%
                        </span>
                      </div>
                      <Slider
                        value={[globalThresholds[group.callType] ?? DEFAULT_DISTANCE_THRESHOLD_PCT]}
                        onValueChange={([val]) => setGlobalThresholds(prev => ({ ...prev, [group.callType!]: val }))}
                        min={1}
                        max={20}
                        step={0.5}
                        className="w-full"
                      />
                    </div>
                  )}
                  
                  {group.putType && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm">Lato Put (prezzo scende)</Label>
                        <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
                          {globalThresholds[group.putType] ?? DEFAULT_DISTANCE_THRESHOLD_PCT}%
                        </span>
                      </div>
                      <Slider
                        value={[globalThresholds[group.putType] ?? DEFAULT_DISTANCE_THRESHOLD_PCT]}
                        onValueChange={([val]) => setGlobalThresholds(prev => ({ ...prev, [group.putType!]: val }))}
                        min={1}
                        max={20}
                        step={0.5}
                        className="w-full"
                      />
                    </div>
                  )}
                </div>
              ))}
            </TabsContent>
            
            {/* Tab 2: Ticker Overrides */}
            <TabsContent value="ticker" className="space-y-4 mt-4">
              {/* Available tickers from strategies */}
              {availableTickers.length > 0 && (
                <div className="space-y-2 p-4 border rounded-lg bg-muted/30">
                  <p className="text-sm font-medium">Ticker disponibili dalle tue strategie:</p>
                  <div className="flex flex-wrap gap-2">
                    {availableTickers.map(({ ticker }) => (
                      <Badge
                        key={ticker}
                        variant={isTickerInOverrides(ticker) ? "default" : "outline"}
                        className={`cursor-pointer transition-colors ${
                          isTickerInOverrides(ticker) 
                            ? 'bg-primary/20 text-primary-foreground' 
                            : 'hover:bg-primary/10'
                        }`}
                        onClick={() => !isTickerInOverrides(ticker) && handleAddTickerFromList(ticker)}
                      >
                        {ticker}
                        {isTickerInOverrides(ticker) && <Check className="w-3 h-3 ml-1" />}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Clicca su un ticker per aggiungere un override
                  </p>
                </div>
              )}
              
              {/* Unresolved underlyings */}
              {unresolvedUnderlyings.length > 0 && (
                <div className="space-y-3 p-4 border rounded-lg border-amber-500/30 bg-amber-500/5">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    <p className="text-sm font-medium">Ticker non risolti:</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Questi sottostanti non hanno un ticker associato. Inserisci il ticker corretto per poterli usare negli avvisi.
                  </p>
                  
                  <div className="space-y-2">
                    {unresolvedUnderlyings.map(underlying => (
                      <div key={underlying} className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground min-w-[150px] truncate">
                          {underlying}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <Input
                          placeholder="Ticker (es. APP)"
                          value={unresolvedMappings[underlying] || ''}
                          onChange={e => setUnresolvedMappings(prev => ({ 
                            ...prev, 
                            [underlying]: e.target.value.toUpperCase() 
                          }))}
                          className="flex-1 h-8 text-sm"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSaveUnresolvedMapping(underlying)}
                          disabled={savingMapping === underlying || !unresolvedMappings[underlying]?.trim()}
                        >
                          {savingMapping === underlying ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            'Salva'
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Configured overrides */}
              <div className="space-y-3">
                <p className="text-sm font-medium">Override configurati:</p>
                
                {tickerOverrides.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4 border rounded-lg">
                    Nessun override per ticker. Seleziona un ticker dall'elenco sopra o aggiungine uno manualmente.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {tickerOverrides.map(override => (
                      <div key={override.ticker} className="flex items-center gap-3 p-3 border rounded-lg">
                        <Badge variant="outline" className="font-mono">
                          {override.ticker}
                        </Badge>
                        
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Soglia distanza</span>
                            <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
                              {override.threshold}%
                            </span>
                          </div>
                          <Slider
                            value={[override.threshold]}
                            onValueChange={([val]) => handleTickerThresholdChange(override.ticker, val)}
                            min={1}
                            max={20}
                            step={0.5}
                            className="w-full"
                          />
                        </div>
                        
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveTicker(override.ticker)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              {/* Manual ticker input */}
              <div className="pt-4 border-t">
                <p className="text-sm text-muted-foreground mb-2">
                  Aggiungi manualmente un ticker non presente nell'elenco:
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder="Es. APP, NVDA"
                    value={newTicker}
                    onChange={e => setNewTicker(e.target.value.toUpperCase())}
                    onKeyDown={e => e.key === 'Enter' && handleAddTicker()}
                    className="flex-1"
                  />
                  <Button onClick={handleAddTicker} size="sm">
                    <Plus className="w-4 h-4 mr-1" />
                    Aggiungi
                  </Button>
                </div>
              </div>
            </TabsContent>
            
            {/* Tab 3: Action Alerts */}
            <TabsContent value="action" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground mb-4">
                Attiva o disattiva gli avvisi per condizioni specifiche.
              </p>
              
              <div className="space-y-3">
                <h4 className="font-medium text-sm text-muted-foreground">Condizioni di Stato</h4>
                
                {ACTION_ALERT_TYPES.map(type => (
                  <div key={type} className="flex items-center justify-between p-3 border rounded-lg">
                    <Label htmlFor={type} className="cursor-pointer">
                      {ALERT_TYPE_LABELS[type]}
                    </Label>
                    <Switch
                      id={type}
                      checked={actionToggles[type] ?? true}
                      onCheckedChange={checked => setActionToggles(prev => ({ ...prev, [type]: checked }))}
                    />
                  </div>
                ))}
              </div>
              
              <div className="space-y-3 pt-4 border-t">
                <h4 className="font-medium text-sm text-muted-foreground">Leap Gain</h4>
                
                {LEAP_GAIN_ALERT_TYPES.map(type => (
                  <div key={type} className="flex items-center justify-between p-3 border rounded-lg">
                    <Label htmlFor={type} className="cursor-pointer">
                      {ALERT_TYPE_LABELS[type]}
                    </Label>
                    <Switch
                      id={type}
                      checked={actionToggles[type] ?? true}
                      onCheckedChange={checked => setActionToggles(prev => ({ ...prev, [type]: checked }))}
                    />
                  </div>
                ))}
              </div>
            </TabsContent>
            
            {/* Tab 4: Cooldown */}
            <TabsContent value="cooldown" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground mb-4">
                Tempo minimo tra avvisi dello stesso tipo per la stessa posizione dopo un reset.
              </p>
              
              <div className="space-y-4 p-4 border rounded-lg">
                <div className="flex items-center justify-between">
                  <Label>Cooldown globale</Label>
                  <span className="text-lg font-mono bg-muted px-3 py-1 rounded">
                    {formatCooldown(cooldownMinutes)}
                  </span>
                </div>
                
                <Slider
                  value={[cooldownMinutes]}
                  onValueChange={([val]) => setCooldownMinutes(val)}
                  min={60}
                  max={1440}
                  step={60}
                  className="w-full"
                />
                
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1 ora</span>
                  <span>24 ore</span>
                </div>
              </div>
              
              <p className="text-xs text-muted-foreground">
                Dopo che un avviso viene generato, non verrà creato un nuovo avviso per la stessa condizione 
                finché il prezzo non torna in zona sicura e poi ri-entra in zona di pericolo, 
                e solo se è passato il tempo di cooldown.
              </p>
            </TabsContent>
          </Tabs>
        )}
        
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button onClick={handleSave} disabled={isSaving || isLoading}>
            {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Salva
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}