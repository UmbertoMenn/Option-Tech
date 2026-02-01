import { useState, useEffect } from 'react';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { LivePriceData, DIRECTION_DISPLAY_DURATION_MS } from '@/contexts/LivePricesContext';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';

interface LivePriceBadgeProps {
  livePrice: LivePriceData | null;
  currentPrice: number | null;
  currency?: string | null;
  showChange?: boolean;
  compact?: boolean;
}

export function LivePriceBadge({
  livePrice,
  currentPrice,
  currency,
  showChange = true,
  compact = false,
}: LivePriceBadgeProps) {
  const [showDirection, setShowDirection] = useState(false);
  
  // Handle 45-second direction display timer
  useEffect(() => {
    if (!livePrice?.directionTimestamp || !livePrice.priceDirection) {
      setShowDirection(false);
      return;
    }
    
    const elapsed = Date.now() - livePrice.directionTimestamp;
    const remaining = DIRECTION_DISPLAY_DURATION_MS - elapsed;
    
    if (remaining <= 0) {
      setShowDirection(false);
      return;
    }
    
    // Show direction immediately
    setShowDirection(true);
    
    // Set timer to hide after remaining time
    const timer = setTimeout(() => {
      setShowDirection(false);
    }, remaining);
    
    return () => clearTimeout(timer);
  }, [livePrice?.directionTimestamp, livePrice?.priceDirection]);
  
  // If no live price data, show current price from database
  if (!livePrice) {
    if (currentPrice !== null) {
      return (
        <span className="font-mono text-foreground">
          {formatCurrency(currentPrice, currency)}
        </span>
      );
    }
    return <span className="text-muted-foreground">-</span>;
  }
  
  if (livePrice.source === 'error') {
    if (currentPrice !== null) {
      return (
        <span className="font-mono text-muted-foreground">
          {formatCurrency(currentPrice, currency)}
        </span>
      );
    }
    return <span className="text-muted-foreground">-</span>;
  }
  
  const price = livePrice.price;
  const change = livePrice.change;
  const changePct = livePrice.changePct;
  
  if (price === null) {
    return <span className="text-muted-foreground">N/A</span>;
  }
  
  const isPositive = change !== null && change > 0;
  const isNegative = change !== null && change < 0;
  const isNeutral = change === null || change === 0;
  
  const ChangeIcon = isPositive ? ArrowUp : isNegative ? ArrowDown : Minus;
  
  // Direction-based styling (45-second highlight)
  const isDirectionUp = showDirection && livePrice.priceDirection === 'up';
  const isDirectionDown = showDirection && livePrice.priceDirection === 'down';
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn(
          "flex items-center gap-1 transition-colors duration-500",
          compact && "text-sm"
        )}>
          <span className={cn(
            "font-mono font-medium transition-colors duration-500",
            isDirectionUp && "text-profit animate-pulse",
            isDirectionDown && "text-loss animate-pulse",
            !isDirectionUp && !isDirectionDown && "text-foreground"
          )}>
            {formatCurrency(price, currency)}
          </span>
          
          {showChange && !isNeutral && (
            <div className={cn(
              "flex items-center gap-0.5 text-xs transition-colors duration-500",
              isPositive && "text-profit",
              isNegative && "text-loss"
            )}>
              <ChangeIcon className="w-3 h-3" />
              <span>
                {changePct !== null ? `${Math.abs(changePct).toFixed(2)}%` : ''}
              </span>
            </div>
          )}
          
          {/* Live indicator dot - shows when data comes from server-side updates */}
          <span className="relative flex h-2 w-2 ml-1">
            <span className={cn(
              "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
              isDirectionUp && "bg-profit",
              isDirectionDown && "bg-loss",
              !isDirectionUp && !isDirectionDown && "bg-profit"
            )}></span>
            <span className={cn(
              "relative inline-flex rounded-full h-2 w-2",
              isDirectionUp && "bg-profit",
              isDirectionDown && "bg-loss",
              !isDirectionUp && !isDirectionDown && "bg-profit"
            )}></span>
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <div className="text-xs space-y-1">
          <p>Prezzo: {formatCurrency(price, currency)}</p>
          {change !== null && (
            <p className={isPositive ? 'text-profit' : isNegative ? 'text-loss' : ''}>
              Variazione: {isPositive ? '+' : ''}{formatCurrency(change, currency)} ({changePct?.toFixed(2)}%)
            </p>
          )}
          {livePrice.previousPrice !== null && (
            <p className="text-muted-foreground">
              Prezzo precedente: {formatCurrency(livePrice.previousPrice, currency)}
            </p>
          )}
          {livePrice.bid !== null && livePrice.ask !== null && (
            <p>Bid/Ask: {formatCurrency(livePrice.bid, currency)} / {formatCurrency(livePrice.ask, currency)}</p>
          )}
          <p className="text-muted-foreground">
            Aggiornato dal server ogni 5 min
          </p>
          {showDirection && livePrice.priceDirection && (
            <p className={livePrice.priceDirection === 'up' ? 'text-profit' : 'text-loss'}>
              {livePrice.priceDirection === 'up' ? '↑ In rialzo' : '↓ In ribasso'} rispetto all'ultimo aggiornamento
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
