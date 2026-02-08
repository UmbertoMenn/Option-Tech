import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, ShieldAlert, Target, Layers, CircleDollarSign, Rocket, Puzzle, TrendingUp, Newspaper, Settings, Info, AlertCircle, XCircle, CheckCheck, Loader2 } from 'lucide-react';
import { Position } from '@/types/portfolio';
import { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';
import { DerivativeCategories } from '@/lib/derivativeStrategies';
import { useAlerts, useUnreadAlertsCount, useMarkAlertAsRead, useMarkAllAlertsAsRead, useDeleteAlert } from '@/hooks/useAlerts';
import { usePortfolioContext } from '@/contexts/PortfolioContext';
import { AlertSettingsDialog } from './AlertSettingsDialog';
import { Alert, ALERT_TYPE_LABELS, AlertSeverity } from '@/types/alerts';
import { formatDistanceToNow } from 'date-fns';
import { it } from 'date-fns/locale';
interface DerivativesSummaryCardProps {
  categories: DerivativeCategories;
  stockPositions: Position[];
  underlyingPrices: Record<string, UnderlyingPrice>;
  totalCoveredCallContractsByUnderlying: Record<string, number>;
}

// Normalize string for matching (lowercase, remove suffixes, etc.)
function normalizeForMatching(str: string): string {
  return str
    .toUpperCase()
    .replace(/\s+(INC|CORP|LTD|PLC|AG|SA|SPA|ADR|CLASS\s*[A-Z]?)\.?$/gi, '')
    .replace(/^AZ\.\s*/i, '')
    .trim();
}

// Get ticker from position
function getTicker(position: Position | { description?: string; ticker?: string; underlying?: string }): string {
  return position.ticker || position.description?.split(' ')[0] || 'N/A';
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
      {/* Header row - div cliccabile invece di button per permettere tooltip annidati */}
      <div 
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsExpanded(!isExpanded); }}
        className="flex items-center gap-2 w-full text-left hover:bg-muted/30 rounded px-1 -mx-1 transition-colors cursor-pointer"
      >
        <Icon className={`w-4 h-4 ${iconColor} shrink-0`} />
        <span className="text-sm font-bold text-foreground">{title}</span>
        
        {/* Badge con tooltip - ordine originale: dopo il titolo */}
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
      
      {/* Expandable items */}
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
  stockPositions,
  underlyingPrices,
}: DerivativesSummaryCardProps) {
  
  // ============ 1. Call vendute non coperte (Naked Call) ============
  const uncoveredCalls = useMemo(() => {
    const result: { ticker: string; uncoveredContracts: number; strategies: string[] }[] = [];
    
    const underlyingBalance = new Map<string, {
      owned: number;
      soldCalls: number;
      boughtCalls: number;
      strategies: Set<string>;
    }>();
    
    stockPositions.forEach(stock => {
      const key = normalizeForMatching(stock.description || '');
      if (!underlyingBalance.has(key)) {
        underlyingBalance.set(key, { owned: 0, soldCalls: 0, boughtCalls: 0, strategies: new Set() });
      }
      underlyingBalance.get(key)!.owned += stock.quantity;
    });
    
    categories.coveredCalls.forEach(cc => {
      const key = normalizeForMatching(cc.underlying.description || cc.option.underlying || '');
      if (!underlyingBalance.has(key)) {
        underlyingBalance.set(key, { owned: 0, soldCalls: 0, boughtCalls: 0, strategies: new Set() });
      }
      underlyingBalance.get(key)!.soldCalls += cc.contractsCovered;
      underlyingBalance.get(key)!.strategies.add('Covered Call');
    });
    
    categories.ironCondors.forEach(ic => {
      const key = normalizeForMatching(ic.underlying);
      if (!underlyingBalance.has(key)) {
        underlyingBalance.set(key, { owned: 0, soldCalls: 0, boughtCalls: 0, strategies: new Set() });
      }
      underlyingBalance.get(key)!.soldCalls += ic.contracts;
      underlyingBalance.get(key)!.boughtCalls += ic.contracts;
      underlyingBalance.get(key)!.strategies.add('Iron Condor');
    });
    
    categories.doubleDiagonals.forEach(dd => {
      const key = normalizeForMatching(dd.underlying);
      if (!underlyingBalance.has(key)) {
        underlyingBalance.set(key, { owned: 0, soldCalls: 0, boughtCalls: 0, strategies: new Set() });
      }
      underlyingBalance.get(key)!.soldCalls += dd.contracts;
      underlyingBalance.get(key)!.boughtCalls += dd.contracts;
      underlyingBalance.get(key)!.strategies.add('Double Diagonal');
    });
    
    categories.groupedOtherStrategies.forEach(group => {
      const key = normalizeForMatching(group.underlying);
      if (!underlyingBalance.has(key)) {
        underlyingBalance.set(key, { owned: 0, soldCalls: 0, boughtCalls: 0, strategies: new Set() });
      }
      
      group.options.forEach(os => {
        if (os.option.option_type === 'call') {
          if (os.option.quantity < 0) {
            underlyingBalance.get(key)!.soldCalls += Math.abs(os.option.quantity);
          } else {
            underlyingBalance.get(key)!.boughtCalls += os.option.quantity;
          }
        }
      });
      if (group.strategyName) {
        underlyingBalance.get(key)!.strategies.add(group.strategyName);
      }
    });
    
    categories.leapCalls.forEach(lc => {
      const key = normalizeForMatching(lc.option.underlying || lc.option.description);
      if (!underlyingBalance.has(key)) {
        underlyingBalance.set(key, { owned: 0, soldCalls: 0, boughtCalls: 0, strategies: new Set() });
      }
      underlyingBalance.get(key)!.boughtCalls += lc.contracts;
      underlyingBalance.get(key)!.strategies.add('Leap Call');
    });
    
    for (const [key, data] of underlyingBalance) {
      const coveredContracts = Math.floor(data.owned / 100);
      const netSoldCalls = data.soldCalls - data.boughtCalls;
      
      if (netSoldCalls > coveredContracts) {
        const uncovered = netSoldCalls - coveredContracts;
        const ticker = key.split(' ')[0] || key;
        result.push({
          ticker,
          uncoveredContracts: uncovered,
          strategies: Array.from(data.strategies)
        });
      }
    }
    
    return result.sort((a, b) => b.uncoveredContracts - a.uncoveredContracts);
  }, [categories, stockPositions]);
  
  // ============ 2. Covered Call ITM ============
  const coveredCallsITM = useMemo(() => {
    const result: { ticker: string; strike: number; contracts: number }[] = [];
    
    categories.coveredCalls.forEach(cc => {
      const strikePrice = cc.option.strike_price || 0;
      const underlyingPrice = cc.underlying.current_price || 0;
      
      if (underlyingPrice > 0 && strikePrice < underlyingPrice) {
        result.push({
          ticker: getTicker(cc.underlying),
          strike: strikePrice,
          contracts: cc.contractsCovered
        });
      }
    });
    
    return result.sort((a, b) => a.ticker.localeCompare(b.ticker));
  }, [categories.coveredCalls]);
  
  // ============ 3. Double Diagonal OOR ============
  const doubleDiagonalOOR = useMemo(() => {
    const result: { ticker: string; isAlternative: boolean }[] = [];
    
    categories.doubleDiagonals.forEach(dd => {
      const underlyingPrice = underlyingPrices[dd.underlying]?.price || 0;
      if (underlyingPrice > 0) {
        const soldPutStrike = dd.soldPut.strike_price || 0;
        const soldCallStrike = dd.soldCall.strike_price || 0;
        const isInRange = underlyingPrice >= soldPutStrike && underlyingPrice <= soldCallStrike;
        
        if (!isInRange) {
          result.push({
            ticker: dd.underlying.split(' ')[0] || dd.underlying,
            isAlternative: false
          });
        }
      }
    });
    
    categories.groupedOtherStrategies
      .filter(g => g.strategyName === 'Alternative Double Diagonal')
      .forEach(group => {
        const underlyingPrice = underlyingPrices[group.underlying]?.price || 0;
        if (underlyingPrice > 0) {
          const soldPut = group.options.find(o => o.option.option_type === 'put' && o.option.quantity < 0);
          const soldCall = group.options.find(o => o.option.option_type === 'call' && o.option.quantity < 0);
          
          if (soldPut && soldCall) {
            const soldPutStrike = soldPut.option.strike_price || 0;
            const soldCallStrike = soldCall.option.strike_price || 0;
            const isInRange = underlyingPrice >= soldPutStrike && underlyingPrice <= soldCallStrike;
            
            if (!isInRange) {
              result.push({
                ticker: group.underlying.split(' ')[0] || group.underlying,
                isAlternative: true
              });
            }
          }
        }
      });
    
    return result.sort((a, b) => a.ticker.localeCompare(b.ticker));
  }, [categories.doubleDiagonals, categories.groupedOtherStrategies, underlyingPrices]);
  
  // ============ 4. Iron Condor OOR ============
  const ironCondorOOR = useMemo(() => {
    const result: { ticker: string }[] = [];
    
    categories.ironCondors.forEach(ic => {
      const underlyingPrice = underlyingPrices[ic.underlying]?.price || 0;
      if (underlyingPrice > 0) {
        const soldPutStrike = ic.soldPut.strike_price || 0;
        const soldCallStrike = ic.soldCall.strike_price || 0;
        const isInRange = underlyingPrice >= soldPutStrike && underlyingPrice <= soldCallStrike;
        
        if (!isInRange) {
          result.push({
            ticker: ic.underlying.split(' ')[0] || ic.underlying
          });
        }
      }
    });
    
    return result.sort((a, b) => a.ticker.localeCompare(b.ticker));
  }, [categories.ironCondors, underlyingPrices]);
  
  // ============ 5. Naked Put ITM ============
  const nakedPutsITM = useMemo(() => {
    const result: { ticker: string; strike: number; contracts: number }[] = [];
    
    categories.nakedPuts.forEach(np => {
      const strikePrice = np.option.strike_price || 0;
      const underlyingPrice = np.underlying?.current_price || 0;
      const isITM = underlyingPrice > 0 && strikePrice > underlyingPrice;
      
      if (isITM) {
        result.push({
          ticker: getTicker({ ticker: np.option.ticker, description: np.option.underlying || np.option.description }),
          strike: strikePrice,
          contracts: np.contracts
        });
      }
    });
    
    return result.sort((a, b) => a.ticker.localeCompare(b.ticker));
  }, [categories.nakedPuts]);
  
  // ============ 6. Leap Call in Gain ============
  const leapCallsInGain = useMemo(() => {
    const result: { ticker: string; strike: number; contracts: number }[] = [];
    
    categories.leapCalls.forEach(lc => {
      const currentPrice = lc.option.current_price || 0;
      const avgCost = lc.option.avg_cost || 0;
      
      if (avgCost > 0 && currentPrice > avgCost) {
        result.push({
          ticker: getTicker({ ticker: lc.option.ticker, description: lc.option.underlying || lc.option.description }),
          strike: lc.option.strike_price || 0,
          contracts: lc.contracts
        });
      }
    });
    
    return result.sort((a, b) => a.ticker.localeCompare(b.ticker));
  }, [categories.leapCalls]);
  
  // ============ 7. Call da rivendere ============
  const availableCallsToSell = useMemo(() => {
    const result: { ticker: string; availableShares: number }[] = [];
    
    stockPositions.forEach(stock => {
      const normalizedKey = normalizeForMatching(stock.description || '');
      const potentialContracts = Math.floor(stock.quantity / 100);
      
      let soldCallContracts = 0;
      
      categories.coveredCalls.forEach(cc => {
        const ccKey = normalizeForMatching(cc.underlying.description || cc.option.underlying || '');
        if (ccKey === normalizedKey) {
          soldCallContracts += cc.contractsCovered;
        }
      });
      
      const available = potentialContracts - soldCallContracts;
      if (available >= 1) {
        result.push({
          ticker: stock.ticker || stock.description?.split(' ')[0] || 'N/A',
          availableShares: available * 100
        });
      }
    });
    
    return result.sort((a, b) => b.availableShares - a.availableShares);
  }, [stockPositions, categories.coveredCalls]);
  
  // ============ 8. Altre Strategie OOR/OOB ============
  const otherStrategiesOOROOB = useMemo(() => {
    const result: { ticker: string; strategyName: string; status: 'OOR' | 'OOB' }[] = [];
    
    const rangeBasedStrategies = ['Short Strangle', 'Put Spread', 'Call Spread', 'Diagonal Put Spread', 'Diagonal Call Spread'];
    
    categories.groupedOtherStrategies
      .filter(g => g.strategyName && g.strategyName !== 'Alternative Double Diagonal')
      .forEach(group => {
        const underlyingPrice = underlyingPrices[group.underlying]?.price || 0;
        if (underlyingPrice <= 0) return;
        
        const strategyName = group.strategyName || 'Strategia';
        const isRangeBased = rangeBasedStrategies.some(s => strategyName.includes(s));
        
        let isInBadState = false;
        let status: 'OOR' | 'OOB';
        
        if (isRangeBased) {
          status = 'OOR';
          if (strategyName.includes('Short Strangle')) {
            const soldPut = group.options.find(o => o.option.option_type === 'put' && o.option.quantity < 0);
            const soldCall = group.options.find(o => o.option.option_type === 'call' && o.option.quantity < 0);
            if (soldPut && soldCall) {
              const soldPutStrike = soldPut.option.strike_price || 0;
              const soldCallStrike = soldCall.option.strike_price || 0;
              isInBadState = !(underlyingPrice >= soldPutStrike && underlyingPrice <= soldCallStrike);
            }
          } else if (strategyName.includes('Put Spread') || strategyName.includes('Diagonal Put Spread')) {
            const soldPut = group.options.find(o => o.option.option_type === 'put' && o.option.quantity < 0);
            if (soldPut) {
              const soldPutStrike = soldPut.option.strike_price || 0;
              isInBadState = underlyingPrice < soldPutStrike;
            }
          } else if (strategyName.includes('Call Spread') || strategyName.includes('Diagonal Call Spread')) {
            const soldCall = group.options.find(o => o.option.option_type === 'call' && o.option.quantity < 0);
            if (soldCall) {
              const soldCallStrike = soldCall.option.strike_price || 0;
              isInBadState = underlyingPrice > soldCallStrike;
            }
          }
        } else {
          status = 'OOB';
          isInBadState = group.totalProfitLoss < 0;
        }
        
        if (isInBadState) {
          result.push({
            ticker: group.underlying.split(' ')[0] || group.underlying,
            strategyName: strategyName.replace('Alternative ', '').replace('Diagonal ', 'Diag. '),
            status
          });
        }
      });
    
    return result.sort((a, b) => a.ticker.localeCompare(b.ticker));
  }, [categories.groupedOtherStrategies, underlyingPrices]);
  
  const hasContent = uncoveredCalls.length > 0 || 
                     coveredCallsITM.length > 0 || 
                     doubleDiagonalOOR.length > 0 ||
                     ironCondorOOR.length > 0 ||
                     nakedPutsITM.length > 0 ||
                     leapCallsInGain.length > 0 ||
                     availableCallsToSell.length > 0 ||
                     otherStrategiesOOROOB.length > 0;
  
  if (!hasContent) {
    return null;
  }
  
  return (
    <div className="grid grid-cols-2 gap-4">
      <Card className="border-border bg-card">
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <CardTitle className="text-xl font-bold tracking-tight">Posizioni da monitorare</CardTitle>
        </div>
      </CardHeader>
        <CardContent className="pt-0">
          {/* 1. Call non coperte */}
          <CompactSection
            title="Call non coperte"
            icon={ShieldAlert}
            iconColor="text-red-500"
            items={uncoveredCalls}
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
            items={coveredCallsITM}
            renderItem={(cc, idx) => (
              <Badge 
                key={idx}
                variant="outline" 
                className="text-xs bg-amber-500/10 border-amber-500/30"
              >
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
            items={doubleDiagonalOOR}
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
            items={ironCondorOOR}
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
            items={nakedPutsITM}
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
            items={leapCallsInGain}
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
            items={otherStrategiesOOROOB}
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
            items={availableCallsToSell}
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
  
  // Hooks devono essere sempre chiamati, prima di qualsiasi return condizionale
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
  
  // In vista aggregata, mostra messaggio informativo (dopo gli hooks!)
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
              {/* Mark all as read button */}
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
              
              {/* Alerts list */}
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
