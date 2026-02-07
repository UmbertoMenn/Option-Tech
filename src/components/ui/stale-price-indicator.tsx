import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { isMarketOpen } from "@/lib/marketHours";

interface StalePriceIndicatorProps {
  className?: string;
  ticker?: string;  // Ticker per determinare il mercato
}

export function StalePriceIndicator({ className, ticker }: StalePriceIndicatorProps) {
  const isMarketClosed = ticker && !isMarketOpen(ticker);
  const message = isMarketClosed ? "Mercato chiuso" : "Prezzo non aggiornato";
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <AlertTriangle 
          className={`w-3 h-3 text-destructive animate-pulse ml-1 cursor-help ${className || ''}`}
        />
      </TooltipTrigger>
      <TooltipContent>
        <p>{message}</p>
      </TooltipContent>
    </Tooltip>
  );
}
