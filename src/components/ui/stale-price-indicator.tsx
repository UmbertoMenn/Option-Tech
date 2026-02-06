import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

interface StalePriceIndicatorProps {
  className?: string;
}

export function StalePriceIndicator({ className }: StalePriceIndicatorProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <AlertTriangle 
          className={`w-3 h-3 text-destructive animate-pulse ml-1 cursor-help ${className || ''}`}
        />
      </TooltipTrigger>
      <TooltipContent>
        <p>Prezzo non aggiornato</p>
      </TooltipContent>
    </Tooltip>
  );
}
