import { useMemo, useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, ShieldAlert, Target, Layers, CircleDollarSign, Rocket, Puzzle, TrendingUp, Newspaper, Settings, Info, AlertCircle, XCircle, CheckCheck, Loader2, CheckCircle2 } from 'lucide-react';
import { Position } from '@/types/portfolio';
import { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';
import { DerivativeCategories } from '@/lib/derivativeStrategies';
import { useAlerts, useUnreadAlertsCount, useMarkAlertAsRead, useMarkAllAlertsAsRead, useDeleteAlert } from '@/hooks/useAlerts';
import { usePortfolioContext } from '@/contexts/PortfolioContext';
import { AlertSettingsDialog } from './AlertSettingsDialog';
import { AlertSeverity } from '@/types/alerts';
import { formatDistanceToNow } from 'date-fns';
import { it } from 'date-fns/locale';
import { StrategyConfiguration } from '@/hooks/useStrategyConfigurations';
import { computeMonitoring, buildSnapshotSections, MonitoringResult } from '@/lib/monitoringEngine';

interface DerivativesSummaryCardProps {
  categories: DerivativeCategories;
  allPositions: Position[];
  stockPositions: Position[];
  underlyingPrices: Record<string, UnderlyingPrice>;
  strategyConfigs: StrategyConfiguration[];
  archivedKeys?: string[];
  missingCount?: number;
  isFetchingMissing?: boolean;
}

// Badge tooltip descriptions
const BADGE_TOOLTIPS: Record<string, string> = {
  'ITM': 'In The Money',
  'OTM': 'Out of The Money',
  'OOR': 'Out of Range: il sottostante è fuori dagli strike venduti',
  'IR': 'In Range: il sottostante è all\'interno degli strike venduti',
  'IB': 'In Breakeven: il sottostante è all\'interno della zona profittevole',
  'OOB': 'Out of Breakeven: il sottostante è fuori dalla zona profittevole',
  'G': 'In Gain: la Leap sta guadagnando',
  'L': 'Loss: la Leap sta perdendo',
  'OOR/OOB': 'Out of Range o Out of Breakeven',
};

// Compact section component - collapsible with count
function CompactSection({
  title, 
  icon: Icon,
  iconColor,
  statusBadge,
  items, 
  renderItem,
}: { 
  title: string;
  icon: React.ElementType;
  iconColor: string;
  statusBadge?: { label: string; colorClass: string };
  items: any[];
  renderItem: (item: any, idx: number) => React.ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (items.length === 0) return null;

  return (
    <div className="py-2 border-b border-border/50 last:border-b-0">
      <div 
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsExpanded(!isExpanded); }}
        className="flex items-center gap-2 w-full text-left hover:bg-muted/30 rounded px-1 -mx-1 transition-colors cursor-pointer"
      >
        <Icon className={`w-4 h-4 ${iconColor} shrink-0`} />
        <span className="text-sm font-bold text-foreground">{title}</span>
        
        {statusBadge && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span 
                className={`inline-flex items-center rounded-full border text-[10px] px-1.5 py-0 h-4 cursor-help ${statusBadge.colorClass}`}
                onClick={(e) => e.stopPropagation()}
              >
                {statusBadge.label}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{BADGE_TOOLTIPS[statusBadge.label] || statusBadge.label}</p>
            </TooltipContent>
          </Tooltip>
        )}
        
        <span className="text-xs text-muted-foreground">
          ({items.length} {items.length === 1 ? 'elemento' : 'elementi'})
        </span>
        <span className="text-xs text-muted-foreground ml-auto">
          {isExpanded ? '▲' : '▼'}
        </span>
      </div>
      
      {isExpanded && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2 pl-6">
          {items.map((item, idx) => renderItem(item, idx))}
        </div>
      )}
    </div>
  );
}

export function DerivativesSummaryCard({
  categories,
  allPositions,
  stockPositions,
  underlyingPrices,
  strategyConfigs,
  archivedKeys = [],
  missingCount = 0,
  isFetchingMissing = false,
}: DerivativesSummaryCardProps) {
  const { selectedPortfolioId } = usePortfolioContext();
  const snapshotSavedRef = useRef(false);
  
  // ============ Single canonical monitoring computation ============
  const monitoring: MonitoringResult = useMemo(() => {
    return computeMonitoring(categories, allPositions, stockPositions, underlyingPrices, strategyConfigs, archivedKeys);
  }, [categories, allPositions, stockPositions, underlyingPrices, strategyConfigs, archivedKeys]);

  // ============ Save monitoring snapshot ============
  useEffect(() => {
    if (isFetchingMissing || !selectedPortfolioId) return;
    if (snapshotSavedRef.current) return;

    const sections = buildSnapshotSections(monitoring);

    snapshotSavedRef.current = true;
    supabase
      .from('monitoring_snapshot' as any)
      .upsert(
        { portfolio_id: selectedPortfolioId, sections, updated_at: new Date().toISOString() } as any,
        { onConflict: 'portfolio_id' }
      )
      .then(({ error }) => {
        if (error) console.error('Failed to save monitoring snapshot:', error);
        else console.log('Monitoring snapshot saved');
      });
  }, [isFetchingMissing, selectedPortfolioId, monitoring]);

  // Reset ref when portfolio changes
  useEffect(() => {
    snapshotSavedRef.current = false;
  }, [selectedPortfolioId]);

  const hasContent = monitoring.uncoveredCalls.length > 0 || 
                     monitoring.coveredCallsITM.length > 0 || 
                     monitoring.doubleDiagonalOOR.length > 0 ||
                     monitoring.ironCondorOOR.length > 0 ||
                     monitoring.nakedPutsITM.length > 0 ||
                     monitoring.leapCallsInGain.length > 0 ||
                     monitoring.availableCallsToSell.length > 0 ||
                     monitoring.otherStrategiesOOROOB.length > 0;
  
  if (!hasContent) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-border bg-card">
          <CardHeader className="pb-3 border-b border-border">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <CardTitle className="text-xl font-bold tracking-tight">Posizioni da monitorare</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="flex flex-col items-center justify-center min-h-[200px] text-center">
              <CheckCircle2 className="w-10 h-10 text-green-500 mb-3" />
              <p className="text-sm text-muted-foreground">
                Tutto sotto controllo. Nessuna posizione richiede monitoraggio immediato.
              </p>
            </div>
          </CardContent>
        </Card>
        
        <RecentAlertsCard categories={categories} underlyingPrices={underlyingPrices} />
      </div>
    );
  }
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card className="border-border bg-card">
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <CardTitle className="text-xl font-bold tracking-tight">Posizioni da monitorare</CardTitle>
        </div>
        {isFetchingMissing && missingCount > 0 && (
          <div className="flex items-center gap-2 mt-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
            <span className="text-xs text-blue-400">
              Risoluzione AI in corso per {missingCount} strumenti...
            </span>
          </div>
        )}
      </CardHeader>
        <CardContent className="pt-0">
          {/* 1. Call non coperte */}
          <CompactSection
            title="Call non coperte"
            icon={ShieldAlert}
            iconColor="text-red-500"
            items={monitoring.uncoveredCalls}
            renderItem={(uc, idx) => (
              <Badge 
                key={idx}
                variant="outline" 
                className="text-xs bg-red-500/10 border-red-500/30"
              >
                {uc.ticker}: {uc.uncoveredContracts}NC
              </Badge>
            )}
          />
          
          {/* 2. Covered Call */}
          <CompactSection
            title="Covered Call"
            icon={ShieldAlert}
            iconColor="text-amber-500"
            statusBadge={{ label: 'ITM', colorClass: 'bg-amber-500/20 border-amber-500/50 text-amber-400' }}
            items={monitoring.coveredCallsITM}
            renderItem={(cc, idx) => (
              <Badge 
                key={idx}
                variant="outline" 
                className="text-xs bg-amber-500/10 border-amber-500/30"
              >
                {cc.isDeRisking && <span className="font-semibold text-amber-400 mr-1">DR</span>}
                {cc.ticker} ${cc.strike} ×{cc.contracts}
              </Badge>
            )}
          />
          
          {/* 3. Double Diagonal */}
          <CompactSection
            title="Double Diagonal"
            icon={Layers}
            iconColor="text-purple-500"
            statusBadge={{ label: 'OOR', colorClass: 'bg-red-500/20 border-red-500/50 text-red-400' }}
            items={monitoring.doubleDiagonalOOR}
            renderItem={(dd, idx) => (
              <Badge 
                key={idx}
                variant="outline" 
                className="text-xs bg-purple-500/10 border-purple-500/30"
              >
                {dd.ticker}{dd.isAlternative ? ' (Alt)' : ''}
              </Badge>
            )}
          />
          
          {/* 4. Iron Condor */}
          <CompactSection
            title="Iron Condor"
            icon={Target}
            iconColor="text-amber-500"
            statusBadge={{ label: 'OOR', colorClass: 'bg-red-500/20 border-red-500/50 text-red-400' }}
            items={monitoring.ironCondorOOR}
            renderItem={(ic, idx) => (
              <Badge 
                key={idx}
                variant="outline" 
                className="text-xs bg-amber-500/10 border-amber-500/30"
              >
                {ic.ticker}
              </Badge>
            )}
          />
          
          {/* 5. Naked Put */}
          <CompactSection
            title="Naked Put"
            icon={CircleDollarSign}
            iconColor="text-orange-500"
            statusBadge={{ label: 'ITM', colorClass: 'bg-amber-500/20 border-amber-500/50 text-amber-400' }}
            items={monitoring.nakedPutsITM}
            renderItem={(np, idx) => (
              <Badge 
                key={idx}
                variant="outline" 
                className="text-xs bg-orange-500/10 border-orange-500/30"
              >
                {np.ticker} ${np.strike} ×{np.contracts}
              </Badge>
            )}
          />
          
          {/* 6. Leap Call */}
          <CompactSection
            title="Leap Call"
            icon={Rocket}
            iconColor="text-blue-500"
            statusBadge={{ label: 'G', colorClass: 'bg-green-500/20 border-green-500/50 text-green-400' }}
            items={monitoring.leapCallsInGain}
            renderItem={(lc, idx) => (
              <Badge 
                key={idx}
                variant="outline" 
                className="text-xs bg-blue-500/10 border-blue-500/30"
              >
                {lc.ticker} ${lc.strike} ×{lc.contracts}
              </Badge>
            )}
          />
          
          {/* 7. Altre Strategie OOR/OOB */}
          <CompactSection
            title="Altre Strategie"
            icon={Puzzle}
            iconColor="text-cyan-500"
            statusBadge={{ label: 'OOR/OOB', colorClass: 'bg-red-500/20 border-red-500/50 text-red-400' }}
            items={monitoring.otherStrategiesOOROOB}
            renderItem={(os, idx) => (
              <Badge 
                key={idx}
                variant="outline" 
                className="text-xs bg-cyan-500/10 border-cyan-500/30"
              >
                {os.ticker} {os.strategyName} {os.status}
              </Badge>
            )}
          />
          
          {/* 8. Call da rivendere - LAST */}
          <CompactSection
            title="Call da rivendere"
            icon={TrendingUp}
            iconColor="text-green-500"
            items={monitoring.availableCallsToSell}
            renderItem={(item, idx) => (
              <Badge 
                key={idx}
                variant="outline" 
                className="text-xs bg-green-500/10 border-green-500/30"
              >
                {item.ticker} {item.availableShares}az
              </Badge>
            )}
          />
        </CardContent>
      </Card>
      
      {/* Card Avvisi recenti (24 h) */}
      <RecentAlertsCard categories={categories} underlyingPrices={underlyingPrices} />
    </div>
  );
}

// Separate component for recent alerts card
interface RecentAlertsCardProps {
  categories: DerivativeCategories;
  underlyingPrices: Record<string, UnderlyingPrice>;
}

function RecentAlertsCard({ categories, underlyingPrices }: RecentAlertsCardProps) {
  const { selectedPortfolio, isAggregatedView } = usePortfolioContext();
  const portfolioId = selectedPortfolio?.id;
  
  const { data: alerts = [], isLoading: alertsLoading } = useAlerts(portfolioId);
  const { data: unreadCount = 0 } = useUnreadAlertsCount(portfolioId);
  const markAsReadMutation = useMarkAlertAsRead();
  const markAllAsReadMutation = useMarkAllAlertsAsRead();
  const deleteAlertMutation = useDeleteAlert();
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  const getSeverityIcon = (severity: AlertSeverity) => {
    switch (severity) {
      case 'critical':
        return <ShieldAlert className="w-4 h-4 text-destructive" />;
      case 'warning':
        return <AlertCircle className="w-4 h-4 text-amber-500" />;
      default:
        return <Info className="w-4 h-4 text-primary" />;
    }
  };
  
  const handleMarkAsRead = (alertId: string) => {
    markAsReadMutation.mutate(alertId);
  };
  
  const handleMarkAllAsRead = () => {
    markAllAsReadMutation.mutate(portfolioId);
  };
  
  const handleDeleteAlert = (e: React.MouseEvent, alertId: string) => {
    e.stopPropagation();
    deleteAlertMutation.mutate(alertId);
  };
  
  if (isAggregatedView) {
    return (
      <Card className="border-border bg-card">
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Newspaper className="w-5 h-5 text-muted-foreground" />
            <CardTitle className="text-xl font-bold tracking-tight text-muted-foreground">
              Avvisi recenti (24 h)
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="flex flex-col items-center justify-center min-h-[200px] text-center">
            <Info className="w-8 h-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              Gli avvisi sono disponibili per i singoli portfolio.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Seleziona un portfolio specifico per visualizzare e gestire gli avvisi.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <>
      <Card className="border-border bg-card">
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Newspaper className="w-5 h-5 text-primary" />
              <CardTitle className="text-xl font-bold tracking-tight">
                Avvisi recenti (24 h)
              </CardTitle>
              {unreadCount > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {unreadCount}
                </Badge>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSettingsOpen(true)}
                  className="h-8 w-8"
                  aria-label="Gestione avvisi e notifiche"
                >
                  <Settings className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Gestione avvisi e notifiche</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {alertsLoading ? (
            <div className="flex items-center justify-center min-h-[200px]">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : alerts.length === 0 ? (
            <div className="flex items-center justify-center min-h-[200px]">
              <span className="text-muted-foreground text-sm">Nessun avviso nelle ultime 24 ore</span>
            </div>
          ) : (
            <div className="space-y-2">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleMarkAllAsRead}
                  disabled={markAllAsReadMutation.isPending}
                  className="w-full mb-2 text-xs"
                >
                  <CheckCheck className="w-3 h-3 mr-1" />
                  Segna tutti come letti
                </Button>
              )}
              
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {alerts.map(alert => (
                  <div
                    key={alert.id}
                    onClick={() => !alert.read_at && handleMarkAsRead(alert.id)}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      alert.read_at 
                        ? 'bg-muted/30 border-border/50 opacity-60' 
                        : 'bg-card border-border hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {getSeverityIcon(alert.severity)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs font-mono">
                            {alert.ticker}
                          </Badge>
                          {alert.strategy_type && (
                            <span className="text-xs text-muted-foreground">
                              {alert.strategy_type}
                            </span>
                          )}
                        </div>
                        <p className="text-sm line-clamp-2">{alert.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(alert.created_at), { 
                            addSuffix: true,
                            locale: it 
                          })}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-destructive/80 hover:text-destructive"
                        onClick={(e) => handleDeleteAlert(e, alert.id)}
                        disabled={deleteAlertMutation.isPending}
                        aria-label="Elimina avviso"
                      >
                        <XCircle className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      
      <AlertSettingsDialog 
        open={settingsOpen} 
        onOpenChange={setSettingsOpen} 
        categories={categories}
        underlyingPrices={underlyingPrices}
      />
    </>
  );
}
