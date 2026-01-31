import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface OverrideBadgeProps {
  onClick?: () => void;
}

export function OverrideBadge({ onClick }: OverrideBadgeProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge 
          variant="outline" 
          className="bg-blue-500/10 text-blue-500 border-blue-500/30 cursor-pointer hover:bg-blue-500/20 text-xs px-1.5"
          onClick={(e) => {
            e.stopPropagation();
            onClick?.();
          }}
        >
          M
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>Classificazione manuale - clicca per rimuovere</p>
      </TooltipContent>
    </Tooltip>
  );
}
