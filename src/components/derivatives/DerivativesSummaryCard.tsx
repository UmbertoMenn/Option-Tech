import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { Position } from '@/types/portfolio';
import { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';
import { 
  DerivativeCategories,
} from '@/lib/derivativeStrategies';

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

// Expandable section component
function ExpandableSection({ 
  title, 
  items, 
  renderItem,
}: { 
  title: string;
  items: any[];
  renderItem: (item: any, idx: number) => React.ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const INITIAL_SHOW = 5;
  const hasMore = items.length > INITIAL_SHOW;
  const displayItems = isExpanded ? items : items.slice(0, INITIAL_SHOW);

  if (items.length === 0) return null;

  return (
    <div className="p-3 rounded-lg border border-border bg-background/50">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-muted-foreground">({items.length})</span>
      </div>
      <div className="space-y-1">
        {displayItems.map((item, idx) => renderItem(item, idx))}
      </div>
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full mt-2 h-7 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-3 h-3 mr-1" />
              Mostra meno
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3 mr-1" />
              Mostra altri {items.length - INITIAL_SHOW}
            </>
          )}
        </Button>
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
    
    // Build balance per underlying: owned shares vs (sold calls - bought calls)
    const underlyingBalance = new Map<string, {
      owned: number;
      soldCalls: number;
      boughtCalls: number;
      strategies: Set<string>;
    }>();
    
    // Initialize with stock positions
    stockPositions.forEach(stock => {
      const key = normalizeForMatching(stock.description || '');
      if (!underlyingBalance.has(key)) {
        underlyingBalance.set(key, { owned: 0, soldCalls: 0, boughtCalls: 0, strategies: new Set() });
      }
      underlyingBalance.get(key)!.owned += stock.quantity;
    });
    
    // Count Covered Calls (sold)
    categories.coveredCalls.forEach(cc => {
      const key = normalizeForMatching(cc.underlying.description || cc.option.underlying || '');
      if (!underlyingBalance.has(key)) {
        underlyingBalance.set(key, { owned: 0, soldCalls: 0, boughtCalls: 0, strategies: new Set() });
      }
      underlyingBalance.get(key)!.soldCalls += cc.contractsCovered;
      underlyingBalance.get(key)!.strategies.add('Covered Call');
    });
    
    // Count Iron Condors (sold call + bought call)
    categories.ironCondors.forEach(ic => {
      const key = normalizeForMatching(ic.underlying);
      if (!underlyingBalance.has(key)) {
        underlyingBalance.set(key, { owned: 0, soldCalls: 0, boughtCalls: 0, strategies: new Set() });
      }
      underlyingBalance.get(key)!.soldCalls += ic.contracts;
      underlyingBalance.get(key)!.boughtCalls += ic.contracts;
      underlyingBalance.get(key)!.strategies.add('Iron Condor');
    });
    
    // Count Double Diagonals (sold call + bought call)
    categories.doubleDiagonals.forEach(dd => {
      const key = normalizeForMatching(dd.underlying);
      if (!underlyingBalance.has(key)) {
        underlyingBalance.set(key, { owned: 0, soldCalls: 0, boughtCalls: 0, strategies: new Set() });
      }
      underlyingBalance.get(key)!.soldCalls += dd.contracts;
      underlyingBalance.get(key)!.boughtCalls += dd.contracts;
      underlyingBalance.get(key)!.strategies.add('Double Diagonal');
    });
    
    // Count grouped other strategies
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
    
    // Count Leap Calls (bought)
    categories.leapCalls.forEach(lc => {
      const key = normalizeForMatching(lc.option.underlying || lc.option.description);
      if (!underlyingBalance.has(key)) {
        underlyingBalance.set(key, { owned: 0, soldCalls: 0, boughtCalls: 0, strategies: new Set() });
      }
      underlyingBalance.get(key)!.boughtCalls += lc.contracts;
      underlyingBalance.get(key)!.strategies.add('Leap Call');
    });
    
    // Check balance: floor(owned/100) - (soldCalls - boughtCalls) < 0 → Naked Call
    for (const [key, data] of underlyingBalance) {
      const coveredContracts = Math.floor(data.owned / 100);
      const netSoldCalls = data.soldCalls - data.boughtCalls;
      
      if (netSoldCalls > coveredContracts) {
        const uncovered = netSoldCalls - coveredContracts;
        // Get ticker from the key (first part)
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
      
      // CALL is ITM when strike < underlying price
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
  
  // ============ 3. Double Diagonal OOR (include Alternative DD) ============
  const doubleDiagonalOOR = useMemo(() => {
    const result: { ticker: string; isAlternative: boolean }[] = [];
    
    // Regular Double Diagonals
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
    
    // Alternative Double Diagonals (from groupedOtherStrategies)
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
      // PUT is ITM when strike > underlying price
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
  
  // ============ 6. Leap Call in Gain (price > avg cost) ============
  const leapCallsInGain = useMemo(() => {
    const result: { ticker: string; strike: number; contracts: number }[] = [];
    
    categories.leapCalls.forEach(lc => {
      const currentPrice = lc.option.current_price || 0;
      const avgCost = lc.option.avg_cost || 0;
      
      // In Gain when current price > avg cost
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
  
  // Check if there's anything to show
  const hasContent = uncoveredCalls.length > 0 || 
                     coveredCallsITM.length > 0 || 
                     doubleDiagonalOOR.length > 0 ||
                     ironCondorOOR.length > 0 || 
                     nakedPutsITM.length > 0 ||
                     leapCallsInGain.length > 0;
  
  if (!hasContent) {
    return null;
  }
  
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <CardTitle className="text-xl">Azioni Necessarie</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          
          {/* 1. Call non coperte (ALERT) */}
          <ExpandableSection
            title="Call non coperte"
            items={uncoveredCalls}
            renderItem={(uc, idx) => (
              <div key={idx} className="flex items-center gap-2 text-sm">
                <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />
                <span className="font-medium">{uc.ticker}:</span>
                <span className="text-red-500">{uc.uncoveredContracts} NC</span>
                <span className="text-xs text-muted-foreground truncate">({uc.strategies.join(', ')})</span>
              </div>
            )}
          />
          
          {/* 2. Covered Call ITM */}
          <ExpandableSection
            title="Covered Call ITM"
            items={coveredCallsITM}
            renderItem={(cc, idx) => (
              <div key={idx} className="flex items-center gap-2 text-sm">
                <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />
                <span className="font-medium">{cc.ticker}</span>
                <span className="text-muted-foreground">${cc.strike}</span>
                <span className="text-xs">×{cc.contracts}</span>
              </div>
            )}
          />
          
          {/* 3. Double Diagonal OOR */}
          <ExpandableSection
            title="Double Diagonal OOR"
            items={doubleDiagonalOOR}
            renderItem={(dd, idx) => (
              <div key={idx} className="flex items-center gap-2 text-sm">
                <span className="font-medium">
                  {dd.ticker}
                  {dd.isAlternative && <span className="text-xs text-muted-foreground ml-0.5">(Alt)</span>}
                </span>
                <Badge 
                  variant="outline"
                  className="text-xs text-red-500 border-red-500"
                >
                  OOR
                </Badge>
              </div>
            )}
          />
          
          {/* 4. Iron Condor OOR */}
          <ExpandableSection
            title="Iron Condor OOR"
            items={ironCondorOOR}
            renderItem={(ic, idx) => (
              <div key={idx} className="flex items-center gap-2 text-sm">
                <span className="font-medium">{ic.ticker}</span>
                <Badge 
                  variant="outline"
                  className="text-xs text-red-500 border-red-500"
                >
                  OOR
                </Badge>
              </div>
            )}
          />
          
          {/* 5. Naked Put ITM */}
          <ExpandableSection
            title="Naked Put ITM"
            items={nakedPutsITM}
            renderItem={(np, idx) => (
              <div key={idx} className="flex items-center gap-2 text-sm">
                <span className="font-medium">{np.ticker}</span>
                <span className="text-muted-foreground">${np.strike}</span>
                <span className="text-xs">×{np.contracts}</span>
                <Badge 
                  variant="outline"
                  className="text-xs text-red-500 border-red-500"
                >
                  ITM
                </Badge>
              </div>
            )}
          />
          
          {/* 6. Leap Call in Gain */}
          <ExpandableSection
            title="Leap Call in Gain"
            items={leapCallsInGain}
            renderItem={(lc, idx) => (
              <div key={idx} className="flex items-center gap-2 text-sm">
                <span className="font-medium">{lc.ticker}</span>
                <span className="text-muted-foreground">${lc.strike}</span>
                <span className="text-xs">×{lc.contracts}</span>
                <Badge 
                  variant="outline"
                  className="text-xs text-green-500 border-green-500"
                >
                  G
                </Badge>
              </div>
            )}
          />
        </div>
      </CardContent>
    </Card>
  );
}
