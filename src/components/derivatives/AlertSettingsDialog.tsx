import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { usePortfolioContext } from '@/contexts/PortfolioContext';
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
import { DerivativeCategories, CoveredCallPosition, NakedPutPosition, IronCondorPosition, DoubleDiagonalPosition, LeapCallPosition, GroupedOtherStrategy } from '@/lib/derivativeStrategies';
import { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';
import { useStrategyAlertToggles, useUpsertStrategyAlertToggle, useBatchUpsertStrategyAlertToggles } from '@/hooks/useStrategyAlertToggles';

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
  const { isAdminMode } = usePortfolioContext();
  const { data: configs = [], isLoading } = useAlertConfigs();
  const batchUpsertMutation = useBatchUpsertAlertConfigs();
  const deleteConfigMutation = useDeleteAlertConfig();
  const initializeDefaultsMutation = useInitializeDefaultConfigs();
  const resetAlertSystemMutation = useResetAlertSystem();
  
  // Strategy alert toggles hooks
  const { data: strategyToggles = [], isLoading: isLoadingToggles } = useStrategyAlertToggles();
  const upsertToggleMutation = useUpsertStrategyAlertToggle();
  const batchUpsertTogglesMutation = useBatchUpsertStrategyAlertToggles();
  
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
  
  
  // State for new price alert
  const [newPriceTicker, setNewPriceTicker] = useState('');
  const [newPriceDirection, setNewPriceDirection] = useState<'above' | 'below'>('below');
  const [newPriceTarget, setNewPriceTarget] = useState('');
  const [newPriceDeleteAfterTrigger, setNewPriceDeleteAfterTrigger] = useState(false);
  const [validatingTicker, setValidatingTicker] = useState(false);
  const [tickerValidation, setTickerValidation] = useState<{ valid: boolean; price?: number; currency?: string } | null>(null);
  
  // Extract available tickers from strategies
  const { resolved: availableTickers, unresolved: unresolvedUnderlyings } = useMemo(() => 
    extractUniqueTickers(categories, underlyingPrices),
    [categories, underlyingPrices]
  );

  // Build strategy items for "Per Strategia" tab using same key logic as strategyCache.ts
  const strategyItems = useMemo(() => {
    const formatExpiryKey = (expiry: string | null | undefined): string => {
      if (!expiry) return 'noexp';
      const d = new Date(expiry);
      return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    const formatExpiryLabel = (expiry: string | null | undefined): string => {
      if (!expiry) return '';
      const d = new Date(expiry);
      const months = ['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'];
      return `${months[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
    };
    const resolveTicker = (underlying: string): string | null => {
      const tickerMatch = underlying.match(/^[A-Z]{1,5}$/);
      if (tickerMatch) return underlying;
      const priceData = underlyingPrices[underlying];
      if (priceData?.ticker) return priceData.ticker;
      const upperUnderlying = underlying.toUpperCase();
      for (const [key, value] of Object.entries(underlyingPrices)) {
        const upperKey = key.toUpperCase();
        if (upperKey === upperUnderlying || upperKey.includes(upperUnderlying) || upperUnderlying.includes(upperKey)) {
          if (value.ticker) return value.ticker;
        }
      }
      return null;
    };

    interface StrategyItem {
      strategyKey: string;
      strategyType: string;
      label: string;
      groupOrder: number;
    }

    const items: StrategyItem[] = [];

    // Covered Calls
    categories.coveredCalls.forEach((cc) => {
      const underlying = cc.option.underlying || cc.option.description || '';
      const ticker = resolveTicker(underlying) || underlying;
      const key = `cc_${underlying}_${cc.option.strike_price || 0}_${formatExpiryKey(cc.option.expiry_date)}`;
      items.push({
        strategyKey: key,
        strategyType: 'Covered Call',
        label: `${ticker} CALL ${cc.option.strike_price} ${formatExpiryLabel(cc.option.expiry_date)}`,
        groupOrder: 1,
      });
    });

    // Naked Puts
    categories.nakedPuts.forEach((np) => {
      const underlying = np.option.underlying || np.option.description || '';
      const ticker = resolveTicker(underlying) || underlying;
      const key = `np_${underlying}_${np.option.strike_price || 0}_${formatExpiryKey(np.option.expiry_date)}`;
      items.push({
        strategyKey: key,
        strategyType: 'Naked Put',
        label: `${ticker} PUT ${np.option.strike_price} ${formatExpiryLabel(np.option.expiry_date)}`,
        groupOrder: 2,
      });
    });

    // Iron Condors
    categories.ironCondors.forEach((ic) => {
      const ticker = resolveTicker(ic.underlying) || ic.underlying;
      const key = `ic_${ic.underlying}_${ic.soldPut.strike_price || 0}_${ic.soldCall.strike_price || 0}_${formatExpiryKey(ic.soldCall.expiry_date)}`;
      items.push({
        strategyKey: key,
        strategyType: 'Iron Condor',
        label: `${ticker} P${ic.soldPut.strike_price}/C${ic.soldCall.strike_price} ${formatExpiryLabel(ic.soldCall.expiry_date)}`,
        groupOrder: 3,
      });
    });

    // Double Diagonals
    categories.doubleDiagonals.forEach((dd) => {
      const ticker = resolveTicker(dd.underlying) || dd.underlying;
      const key = `dd_${dd.underlying}_${dd.soldPut.strike_price || 0}_${dd.soldCall.strike_price || 0}_${formatExpiryKey(dd.soldCall.expiry_date)}`;
      items.push({
        strategyKey: key,
        strategyType: 'Double Diagonal',
        label: `${ticker} P${dd.soldPut.strike_price}/C${dd.soldCall.strike_price} ${formatExpiryLabel(dd.soldCall.expiry_date)}`,
        groupOrder: 4,
      });
    });

    // LEAP Calls
    categories.leapCalls.forEach((lc) => {
      const underlying = lc.option.underlying || lc.option.description || '';
      const ticker = resolveTicker(underlying) || underlying;
      const key = `leap_${underlying}_${lc.option.strike_price || 0}_${formatExpiryKey(lc.option.expiry_date)}`;
      items.push({
        strategyKey: key,
        strategyType: 'LEAP Call',
        label: `${ticker} CALL ${lc.option.strike_price} ${formatExpiryLabel(lc.option.expiry_date)}`,
        groupOrder: 5,
      });
    });

    // Grouped Other Strategies
    categories.groupedOtherStrategies.forEach((gs) => {
      const ticker = resolveTicker(gs.underlying) || gs.underlying;
      let soldPutStrike: number | null = null;
      let soldCallStrike: number | null = null;
      let soldCallExpiry: string | null = null;
      let soldPutExpiry: string | null = null;

      for (const opt of gs.options) {
        const o = opt.option;
        if (o.quantity < 0) {
          if (o.option_type === 'put' && o.strike_price) {
            if (!soldPutStrike || o.strike_price > soldPutStrike) {
              soldPutStrike = o.strike_price;
              soldPutExpiry = o.expiry_date || null;
            }
          }
          if (o.option_type === 'call' && o.strike_price) {
            if (!soldCallStrike || o.strike_price < soldCallStrike) {
              soldCallStrike = o.strike_price;
              soldCallExpiry = o.expiry_date || null;
            }
          }
        }
      }

      const key = `other_${gs.underlying}_${[soldPutStrike, soldCallStrike].filter(Boolean).sort().join('_')}_${formatExpiryKey(soldCallExpiry || soldPutExpiry)}`;
      const strikesLabel = [soldPutStrike ? `P${soldPutStrike}` : null, soldCallStrike ? `C${soldCallStrike}` : null].filter(Boolean).join('/');
      items.push({
        strategyKey: key,
        strategyType: gs.strategyName || 'Altre Strategie',
        label: `${ticker} ${strikesLabel} ${formatExpiryLabel(soldCallExpiry || soldPutExpiry)}`.trim(),
        groupOrder: 6, // placeholder, will be reassigned below
      });
    });

    // Assign unique progressive groupOrder per distinct strategyName among "other" strategies
    const otherNames = Array.from(new Set(items.filter(i => i.groupOrder === 6).map(i => i.strategyType)));
    items.forEach(i => {
      if (i.groupOrder === 6) {
        i.groupOrder = 6 + otherNames.indexOf(i.strategyType);
      }
    });

    return items.sort((a, b) => a.groupOrder - b.groupOrder || a.label.localeCompare(b.label));
  }, [categories, underlyingPrices]);

  // Build toggles map for quick lookup
  const togglesMap = useMemo(() => {
    const map = new Map<string, boolean>();
    strategyToggles.forEach(t => map.set(t.strategy_key, t.enabled));
    return map;
  }, [strategyToggles]);

  const isStrategyEnabled = useCallback((key: string) => {
    return togglesMap.get(key) ?? true; // default enabled
  }, [togglesMap]);

  const handleToggleStrategy = useCallback(async (strategyKey: string, enabled: boolean) => {
    try {
      await upsertToggleMutation.mutateAsync({ strategy_key: strategyKey, enabled });
    } catch {
      toast.error('Errore nell\'aggiornamento del toggle');
    }
  }, [upsertToggleMutation]);

  const handleToggleAll = useCallback(async (enabled: boolean) => {
    try {
      const toggles = strategyItems.map(item => ({
        strategy_key: item.strategyKey,
        enabled,
      }));
      await batchUpsertTogglesMutation.mutateAsync(toggles);
      toast.success(enabled ? 'Tutti gli avvisi attivati' : 'Tutti gli avvisi disattivati');
    } catch {
      toast.error('Errore nell\'aggiornamento');
    }
  }, [strategyItems, batchUpsertTogglesMutation]);

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
        delete_after_trigger: newPriceDeleteAfterTrigger,
      });
      
      toast.success(`Avviso di prezzo creato per ${ticker}`);
      setNewPriceTicker('');
      setNewPriceTarget('');
      setNewPriceDeleteAfterTrigger(false);
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
            <TabsList className={`grid w-full ${isAdminMode ? 'grid-cols-6' : 'grid-cols-7'}`}>
              <TabsTrigger value="distance">Distanza</TabsTrigger>
              <TabsTrigger value="ticker">Per Ticker</TabsTrigger>
              <TabsTrigger value="strategy">Strategia</TabsTrigger>
              <TabsTrigger value="price">Prezzo</TabsTrigger>
              <TabsTrigger value="action">Stato</TabsTrigger>
              <TabsTrigger value="cooldown">Cooldown</TabsTrigger>
              {!isAdminMode && <TabsTrigger value="notifications">Notifiche</TabsTrigger>}
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
              
              {/* Unresolved underlyings - read-only info */}
              {unresolvedUnderlyings.length > 0 && (
                <div className="space-y-3 p-4 border rounded-lg border-amber-500/30 bg-amber-500/5">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    <p className="text-sm font-medium">Ticker non risolti:</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    I seguenti sottostanti non hanno un ticker associato e non possono essere usati per gli avvisi di distanza. 
                    Contatta un amministratore per risolvere questi mapping.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {unresolvedUnderlyings.map(underlying => (
                      <Badge 
                        key={underlying} 
                        variant="outline" 
                        className="text-amber-500 border-amber-500/30"
                      >
                        {underlying}
                      </Badge>
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
                  
                  <div className="flex items-center gap-2 pt-2">
                    <input
                      type="checkbox"
                      id="delete-after-trigger"
                      checked={newPriceDeleteAfterTrigger}
                      onChange={(e) => setNewPriceDeleteAfterTrigger(e.target.checked)}
                      className="h-4 w-4 rounded border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                    <Label htmlFor="delete-after-trigger" className="text-sm cursor-pointer">
                      Elimina regola dopo trigger
                    </Label>
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
                          
                          {alert.delete_after_trigger && (
                            <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/30">
                              Una tantum
                            </Badge>
                          )}
                          
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

            {/* Tab: Per Strategia */}
            <TabsContent value="strategy" className="mt-4">
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Attiva o disattiva gli avvisi per singola strategia. Le strategie non più presenti dopo un ricaricamento Excel spariscono automaticamente.
                </p>
                
                {strategyItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Nessuna strategia presente. Visita la pagina Strategie Derivati per caricare le posizioni.
                  </p>
                ) : (
                  <>
                    {/* Toggle All */}
                    <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                      <div>
                        <p className="text-sm font-medium">Tutte le strategie</p>
                        <p className="text-xs text-muted-foreground">{strategyItems.length} strategie</p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggleAll(true)}
                          disabled={batchUpsertTogglesMutation.isPending}
                        >
                          Attiva tutte
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggleAll(false)}
                          disabled={batchUpsertTogglesMutation.isPending}
                        >
                          Disattiva tutte
                        </Button>
                      </div>
                    </div>

                    {/* Strategy list grouped by type */}
                    <div className="space-y-1">
                      {(() => {
                        let lastType = '';
                        return strategyItems.map((item) => {
                          const showHeader = item.strategyType !== lastType;
                          lastType = item.strategyType;
                          return (
                            <div key={item.strategyKey}>
                              {showHeader && (
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-3 pb-1 px-1">
                                  {item.strategyType}
                                </p>
                              )}
                              <div className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50">
                                <span className="text-sm">{item.label}</span>
                                <Switch
                                  checked={isStrategyEnabled(item.strategyKey)}
                                  onCheckedChange={(checked) => handleToggleStrategy(item.strategyKey, checked)}
                                  disabled={upsertToggleMutation.isPending}
                                />
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </>
                )}
              </div>
            </TabsContent>

            {/* Tab 5: Notification Settings (hidden in admin mode) */}
            {!isAdminMode && (
              <TabsContent value="notifications" className="mt-4">
                <NotificationSettings />
              </TabsContent>
            )}
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