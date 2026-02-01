import { RefreshCw, Wifi, WifiOff, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatRelativeTime } from '@/lib/formatters';
import { cn } from '@/lib/utils';

interface LivePriceIndicatorProps {
  lastFetched: Date | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function LivePriceIndicator({
  lastFetched,
  isLoading,
  error,
  onRefresh,
}: LivePriceIndicatorProps) {
  const hasRecentUpdate = lastFetched && (Date.now() - lastFetched.getTime()) < 600000; // 10 minutes
  
  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5">
            {hasRecentUpdate ? (
              <Server className="w-4 h-4 text-profit" />
            ) : error ? (
              <WifiOff className="w-4 h-4 text-muted-foreground" />
            ) : (
              <Wifi className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="text-xs text-muted-foreground">
              {lastFetched ? formatRelativeTime(lastFetched.toISOString()) : 'Mai aggiornato'}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs space-y-1">
            {error ? (
              <p className="text-destructive">Errore: {error}</p>
            ) : hasRecentUpdate ? (
              <>
                <p className="font-medium">Prezzi aggiornati dal server</p>
                <p className="text-muted-foreground">Aggiornamento automatico ogni 5 min</p>
              </>
            ) : (
              <p>In attesa del prossimo aggiornamento...</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
      
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onRefresh}
            disabled={isLoading}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">I prezzi vengono aggiornati automaticamente ogni 5 minuti dal server</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
