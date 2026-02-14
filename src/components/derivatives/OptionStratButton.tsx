import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface OptionStratButtonProps {
  url: string | null;
}

export function OptionStratButton({ url }: OptionStratButtonProps) {
  if (!url) return <div />;
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            window.open(url, '_blank', 'noopener,noreferrer');
          }}
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Apri su OptionStrat</p>
      </TooltipContent>
    </Tooltip>
  );
}
