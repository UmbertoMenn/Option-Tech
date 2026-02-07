import { useState, useEffect, useMemo, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle, 
  AlertDialogTrigger 
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Trash2, Plus, Loader2, AlertTriangle, Check, TrendingUp, TrendingDown, DollarSign, RotateCcw } from 'lucide-react';
import { NotificationSettings } from '@/components/settings/NotificationSettings';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useResetAlertSystem } from '@/hooks/useAlerts';
import { 
  useAlertConfigs, 
  useBatchUpsertAlertConfigs,
  useDeleteAlertConfig,
  useInitializeDefaultConfigs,
} from '@/hooks/useAlertConfigs';
import {
  usePriceAlerts,
  useCreatePriceAlert,
  useDeletePriceAlert,
  useTogglePriceAlert,
  validateTicker,
} from '@/hooks/usePriceAlerts';
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
  const resetAlertSystemMutation = useResetAlertSystem();
  
  // Price alerts hooks
  const { data: priceAlerts = [], isLoading: isLoadingPriceAlerts } = usePriceAlerts();
  const createPriceAlertMutation = useCreatePriceAlert();
  const deletePriceAlertMutation = useDeletePriceAlert();
  const togglePriceAlertMutation = useTogglePriceAlert();
  
  // State for reset confirmation dialog
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  
  // Local state for editing
  const [globalThresholds, setGlobalThresholds] = useState<Record<AlertType, number>>({} as Record<AlertType, number>);
  const [distanceEnabled, setDistanceEnabled] = useState<Record<AlertType, boolean>>({} as Record<AlertType, boolean>);
  const [actionToggles, setActionToggles] = useState<Record<AlertType, boolean>>({} as Record<AlertType, boolean>);
  const [cooldownMinutes, setCooldownMinutes] = useState(DEFAULT_COOLDOWN_MINUTES);
  const [tickerOverrides, setTickerOverrides] = useState<Array<{ ticker: string; alertTypes: AlertType[]; threshold: number }>>([]);
  const [bulkThreshold, setBulkThreshold] = useState(DEFAULT_DISTANCE_THRESHOLD_PCT);
  const [newTicker, setNewTicker] = useState('');
  
  // State for unresolved ticker mappings
  const [unresolvedMappings, setUnresolvedMappings] = useState<Record<string, string>>({});
  const [savingMapping, setSavingMapping] = useState<string | null>(null);
  
  // State for new price alert
  const [newPriceTicker, setNewPriceTicker] = useState('');
  const [newPriceDirection, setNewPriceDirection] = useState<'above' | 'below'>('below');
  const [newPriceTarget, setNewPriceTarget] = useState('');
  const [validatingTicker, setValidatingTicker] = useState(false);
  const [tickerValidation, setTickerValidation] = useState<{ valid: boolean; price?: number; currency?: string } | null>(null);
  
  // Extract available tickers from strategies
  const { resolved: availableTickers, unresolved: unresolvedUnderlyings } = useMemo(() => 
    extractUniqueTickers(categories, underlyingPrices),
    [categories, underlyingPrices]
  );
  
  // Ref to prevent multiple initialization attempts (fixes infinite loop)
  const initAttemptedRef = useRef(false);
  
  // Initialize local state from configs
  useEffect(() => {
    if (configs.length === 0 && !isLoading) {
      // Only initialize once to prevent infinite loop
      if (!initAttemptedRef.current) {
        initAttemptedRef.current = true;
        initializeDefaultsMutation.mutate();
      }
      return;
    }
    
    // Reset when we have configs (handles logout/login scenarios)
    if (configs.length > 0) {
      initAttemptedRef.current = false;
    }
    
    // Set global thresholds and enabled states for distance alerts
    const thresholds: Record<AlertType, number> = {} as Record<AlertType, number>;
    const enabledStates: Record<AlertType, boolean> = {} as Record<AlertType, boolean>;
    DISTANCE_ALERT_TYPES.forEach(type => {
      const config = configs.find(c => c.alert_type === type && c.ticker === null);
      thresholds[type] = config?.threshold_pct ?? DEFAULT_DISTANCE_THRESHOLD_PCT;
      enabledStates[type] = config?.enabled ?? true;
    });
    setGlobalThresholds(thresholds);
    setDistanceEnabled(enabledStates);
    
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
      
      // Global distance thresholds with enabled state
      DISTANCE_ALERT_TYPES.forEach(type => {
        configsToUpsert.push({
          alert_type: type,
          ticker: null,
          threshold_pct: globalThresholds[type] ?? DEFAULT_DISTANCE_THRESHOLD_PCT,
          cooldown_minutes: cooldownMinutes,
          enabled: distanceEnabled[type] ?? true,
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
  
  // Handle ticker validation for price alerts
  const handleValidatePriceTicker = async () => {
    const ticker = newPriceTicker.trim().toUpperCase();
    if (!ticker) return;
    
    setValidatingTicker(true);
    setTickerValidation(null);
    
    try {
      const result = await validateTicker(ticker);
      setTickerValidation(result);
      if (!result.valid) {
        toast.error(`Ticker "${ticker}" non trovato`);
      }
    } catch {
      setTickerValidation({ valid: false });
      toast.error('Errore durante la validazione del ticker');
    } finally {
      setValidatingTicker(false);
    }
  };
  
  // Handle create new price alert
  const handleCreatePriceAlert = async () => {
    const ticker = newPriceTicker.trim().toUpperCase();
    const targetPrice = parseFloat(newPriceTarget);
    
    if (!ticker || isNaN(targetPrice) || targetPrice <= 0) {
      toast.error('Inserisci un ticker valido e un prezzo target maggiore di zero');
      return;
    }
    
    try {
      await createPriceAlertMutation.mutateAsync({
        ticker,
        direction: newPriceDirection,
        target_price: targetPrice,
        cooldown_minutes: cooldownMinutes,
      });
      
      toast.success(`Avviso di prezzo creato per ${ticker}`);
      setNewPriceTicker('');
      setNewPriceTarget('');
      setTickerValidation(null);
    } catch (error: any) {
      if (error.code === '23505') {
        toast.error('Esiste già un avviso identico per questo ticker');
      } else {
        toast.error('Errore nella creazione dell\'avviso');
      }
    }
  };
  
  // Handle delete price alert
  const handleDeletePriceAlert = async (id: string) => {
    try {
      await deletePriceAlertMutation.mutateAsync(id);
      toast.success('Avviso eliminato');
    } catch {
      toast.error('Errore nell\'eliminazione dell\'avviso');
    }
  };
  
  // Handle toggle price alert
  const handleTogglePriceAlert = async (id: string, enabled: boolean) => {
    try {
      await togglePriceAlertMutation.mutateAsync({ id, enabled });
    } catch {
      toast.error('Errore nell\'aggiornamento dell\'avviso');
    }
  };
  
  // Handle reset alert system
  const handleResetAlertSystem = async () => {
    try {
      await resetAlertSystemMutation.mutateAsync();
      toast.success('Sistema avvisi resettato con successo');
      setShowResetConfirm(false);
    } catch (error) {
      console.error('Error resetting alert system:', error);
      toast.error('Errore nel reset del sistema avvisi');
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gestione avvisi e notifiche</DialogTitle>
          <DialogDescription>
            Configura le soglie e le notifiche per le strategie derivate e i prezzi dei ticker
          </DialogDescription>
        </DialogHeader>
        
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="distance" className="w-full">
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="distance">Distanza</TabsTrigger>
              <TabsTrigger value="ticker">Per Ticker</TabsTrigger>
              <TabsTrigger value="price">Prezzo</TabsTrigger>
              <TabsTrigger value="action">Stato</TabsTrigger>
              <TabsTrigger value="cooldown">Cooldown</TabsTrigger>
              <TabsTrigger value="notifications">Notifiche</TabsTrigger>
            </TabsList>
            
            {/* Tab 1: Global Distance Thresholds */}
            <TabsContent value="distance" className="mt-4">
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Soglie globali per gli avvisi di distanza dallo strike. Valori più bassi = avvisi più tempestivi.
                  </p>
                  
                  {/* Bulk threshold setter */}
                  <div className="p-3 border rounded-lg bg-muted/30">
                    <div className="flex items-center gap-3">
                      <Label className="text-sm font-medium whitespace-nowrap">Imposta tutte le soglie:</Label>
                      <Slider
                        value={[bulkThreshold]}
                        onValueChange={([val]) => setBulkThreshold(val)}
                        min={0}
                        max={20}
                        step={0.5}
                        className="flex-1"
                      />
                      <span className="text-sm font-mono bg-background px-2 py-0.5 rounded border min-w-[40px] text-center">
                        {bulkThreshold}%
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const updated: Record<AlertType, number> = {} as Record<AlertType, number>;
                          DISTANCE_ALERT_TYPES.forEach(type => {
                            updated[type] = bulkThreshold;
                          });
                          setGlobalThresholds(prev => ({ ...prev, ...updated }));
                          toast.success(`Tutte le soglie impostate a ${bulkThreshold}%`);
                        }}
                      >
                        Applica
                      </Button>
                    </div>
                  </div>
                  
                  {GROUPED_DISTANCE_ALERTS.map(group => {
                    // Determine if the whole group is enabled
                    const groupAlertTypes = [group.callType, group.putType].filter(Boolean) as AlertType[];
                    const isGroupEnabled = groupAlertTypes.some(type => distanceEnabled[type] ?? true);
                    
                    // Toggle handler for the group
                    const handleGroupToggle = (enabled: boolean) => {
                      setDistanceEnabled(prev => {
                        const updated = { ...prev };
                        groupAlertTypes.forEach(type => {
                          updated[type] = enabled;
                        });
                        return updated;
                      });
                    };
                    
                    return (
                      <div key={group.label} className={`space-y-3 p-4 border rounded-lg transition-opacity ${!isGroupEnabled ? 'opacity-50' : ''}`}>
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium">{group.label}</h4>
                          <Switch
                            checked={isGroupEnabled}
                            onCheckedChange={handleGroupToggle}
                          />
                        </div>
                        
                        {group.callType && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className={`text-sm ${!isGroupEnabled ? 'text-muted-foreground' : ''}`}>
                                Lato Call (prezzo sale)
                              </Label>
                              <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
                                {globalThresholds[group.callType] ?? DEFAULT_DISTANCE_THRESHOLD_PCT}%
                              </span>
                            </div>
                            <Slider
                              value={[globalThresholds[group.callType] ?? DEFAULT_DISTANCE_THRESHOLD_PCT]}
                              onValueChange={([val]) => setGlobalThresholds(prev => ({ ...prev, [group.callType!]: val }))}
                              min={0}
                              max={20}
                              step={0.5}
                              className="w-full"
                              disabled={!isGroupEnabled}
                            />
                          </div>
                        )}
                        
                        {group.putType && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className={`text-sm ${!isGroupEnabled ? 'text-muted-foreground' : ''}`}>
                                Lato Put (prezzo scende)
                              </Label>
                              <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
                                {globalThresholds[group.putType] ?? DEFAULT_DISTANCE_THRESHOLD_PCT}%
                              </span>
                            </div>
                            <Slider
                              value={[globalThresholds[group.putType] ?? DEFAULT_DISTANCE_THRESHOLD_PCT]}
                              onValueChange={([val]) => setGlobalThresholds(prev => ({ ...prev, [group.putType!]: val }))}
                              min={0}
                              max={20}
                              step={0.5}
                              className="w-full"
                              disabled={!isGroupEnabled}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
            </TabsContent>
            
            {/* Tab 2: Ticker Overrides */}
            <TabsContent value="ticker" className="mt-4">
                <div className="space-y-4">
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
                </div>
            </TabsContent>
            
            {/* Tab 3: Price Alerts */}
            <TabsContent value="price" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Crea avvisi di prezzo su qualsiasi ticker, anche se non presente nel tuo portafoglio.
              </p>
              
              {/* Available tickers from portfolio */}
              {availableTickers.length > 0 && (
                <div className="space-y-2 p-4 border rounded-lg bg-muted/30">
                  <p className="text-sm font-medium">Ticker dal portafoglio:</p>
                  <div className="flex flex-wrap gap-2">
                    {availableTickers.map(({ ticker }) => (
                      <Badge
                        key={ticker}
                        variant="outline"
                        className="cursor-pointer hover:bg-primary/10 transition-colors"
                        onClick={() => {
                          setNewPriceTicker(ticker);
                          setTickerValidation(null);
                        }}
                      >
                        {ticker}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Clicca su un ticker per compilarlo automaticamente
                  </p>
                </div>
              )}
              
              {/* New price alert form */}
              <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                <h4 className="font-medium flex items-center gap-2">
                  <DollarSign className="w-4 h-4" />
                  Nuovo avviso di prezzo
                </h4>
                
                <div className="grid gap-3">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Ticker (es. LEU, AAPL)"
                      value={newPriceTicker}
                      onChange={e => {
                        setNewPriceTicker(e.target.value.toUpperCase());
                        setTickerValidation(null);
                      }}
                      className="flex-1"
                    />
                    <Button 
                      variant="outline" 
                      onClick={handleValidatePriceTicker}
                      disabled={validatingTicker || !newPriceTicker.trim()}
                    >
                      {validatingTicker ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : tickerValidation?.valid ? (
                        <Check className="w-4 h-4 text-green-500" />
                      ) : (
                        'Verifica'
                      )}
                    </Button>
                  </div>
                  
                  {tickerValidation?.valid && tickerValidation.price && (
                    <p className="text-sm text-muted-foreground">
                      Prezzo attuale: <span className="font-mono font-medium">${tickerValidation.price.toFixed(2)}</span>
                      {tickerValidation.currency && tickerValidation.currency !== 'USD' && ` (${tickerValidation.currency})`}
                    </p>
                  )}
                  
                  <div className="space-y-2">
                    <Label>Tipo di avviso</Label>
                    <RadioGroup
                      value={newPriceDirection}
                      onValueChange={(v) => setNewPriceDirection(v as 'above' | 'below')}
                      className="flex gap-4"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="below" id="below" />
                        <Label htmlFor="below" className="flex items-center gap-1 cursor-pointer">
                          <TrendingDown className="w-4 h-4 text-red-500" />
                          Sotto soglia
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="above" id="above" />
                        <Label htmlFor="above" className="flex items-center gap-1 cursor-pointer">
                          <TrendingUp className="w-4 h-4 text-green-500" />
                          Sopra soglia
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                  
                  <div className="flex gap-2 items-end">
                    <div className="flex-1 space-y-1">
                      <Label>Prezzo target</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="Es. 100.00"
                        value={newPriceTarget}
                        onChange={e => setNewPriceTarget(e.target.value)}
                      />
                    </div>
                    <Button 
                      onClick={handleCreatePriceAlert}
                      disabled={createPriceAlertMutation.isPending || !newPriceTicker.trim() || !newPriceTarget}
                    >
                      {createPriceAlertMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-1" />
                      ) : (
                        <Plus className="w-4 h-4 mr-1" />
                      )}
                      Aggiungi
                    </Button>
                  </div>
                </div>
              </div>
              
              {/* Existing price alerts */}
              <div className="space-y-3">
                <h4 className="font-medium text-sm">Avvisi configurati</h4>
                
                {isLoadingPriceAlerts ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : priceAlerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4 border rounded-lg">
                    Nessun avviso di prezzo configurato. Usa il form sopra per crearne uno.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {priceAlerts.map(alert => {
                      const currentPrice = underlyingPrices[alert.ticker]?.price;
                      return (
                        <div key={alert.id} className="flex items-center gap-3 p-3 border rounded-lg">
                          <Badge variant="outline" className="font-mono">
                            {alert.ticker}
                          </Badge>
                          
                          <div className="flex items-center gap-1">
                            {alert.direction === 'above' ? (
                              <TrendingUp className="w-4 h-4 text-green-500" />
                            ) : (
                              <TrendingDown className="w-4 h-4 text-red-500" />
                            )}
                            <span className="text-sm">
                              {alert.direction === 'above' ? '>' : '<'} ${alert.target_price.toFixed(2)}
                            </span>
                          </div>
                          
                          <div className="flex-1 text-xs text-muted-foreground">
                            {currentPrice !== undefined && (
                              <span>Attuale: ${currentPrice.toFixed(2)}</span>
                            )}
                          </div>
                          
                          <Switch
                            checked={alert.enabled}
                            onCheckedChange={checked => handleTogglePriceAlert(alert.id, checked)}
                          />
                          
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeletePriceAlert(alert.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </TabsContent>
            
            {/* Tab 4: Action Alerts */}
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
            
            {/* Tab 5: Notification Settings */}
            <TabsContent value="notifications" className="mt-4">
              <NotificationSettings />
            </TabsContent>
          </Tabs>
        )}
        
        <DialogFooter className="mt-4 flex-col sm:flex-row gap-2">
          <div className="flex-1 flex justify-start">
            <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
              <AlertDialogTrigger asChild>
                <Button 
                  variant="outline" 
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/50"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reset Sistema
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-destructive" />
                    Sei sicuro di voler resettare?
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-left space-y-3">
                    <p>Questa azione eliminerà:</p>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>Lo storico di tutti gli avvisi generati</li>
                      <li>La memoria degli stati delle posizioni (safe/alerted)</li>
                    </ul>
                    <p className="pt-2">
                      Il sistema ricomincerà a monitorare le posizioni da zero. 
                      Utile se hai caricato un Excel sbagliato con posizioni errate o se hai necessità di resettare gli alerts.
                    </p>
                    <p className="text-sm font-medium text-foreground pt-2">
                      Le tue configurazioni (soglie, notifiche) NON verranno modificate.
                    </p>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annulla</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleResetAlertSystem}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    disabled={resetAlertSystemMutation.isPending}
                  >
                    {resetAlertSystemMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4 mr-2" />
                    )}
                    Conferma Reset
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Annulla
            </Button>
            <Button onClick={handleSave} disabled={isSaving || isLoading}>
              {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Salva
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}