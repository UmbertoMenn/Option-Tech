import { useState } from 'react';
import { MoveHorizontal, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Position } from '@/types/portfolio';
import { OverrideCategory, DerivativeOverride } from '@/types/derivativeOverrides';
import { LinkStockDialog } from './LinkStockDialog';
import { useDerivativeOverrides } from '@/hooks/useDerivativeOverrides';

interface MoveOptionMenuProps {
  option: Position;
  currentCategory?: OverrideCategory | 'iron_condor' | 'double_diagonal';
  existingOverride?: DerivativeOverride | null;
}

const CATEGORY_LABELS: Record<OverrideCategory, string> = {
  covered_call: 'Covered Call',
  protection: 'Protezione',
  naked_put: 'Naked Put',
  leap_call: 'Leap Call',
  other: 'Altre Strategie'
};

export function MoveOptionMenu({ option, currentCategory, existingOverride }: MoveOptionMenuProps) {
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [pendingCategory, setPendingCategory] = useState<OverrideCategory | null>(null);
  
  const { 
    createSingleOverride, 
    removeOverrideByPositionId,
    getAvailableStocks,
    isCreatingSingle,
    isRemoving
  } = useDerivativeOverrides();

  const isCall = option.option_type === 'call';
  const isPut = option.option_type === 'put';
  const isSold = option.quantity < 0;
  const isBought = option.quantity > 0;

  // Determine which categories are valid for this option
  const getValidCategories = (): OverrideCategory[] => {
    const categories: OverrideCategory[] = [];
    
    // Covered Call: only for sold CALLs
    if (isCall && isSold) {
      categories.push('covered_call');
    }
    
    // Protection: only for bought PUTs
    if (isPut && isBought) {
      categories.push('protection');
    }
    
    // Naked Put: only for sold PUTs
    if (isPut && isSold) {
      categories.push('naked_put');
    }
    
    // Leap Call: only for bought CALLs
    if (isCall && isBought) {
      categories.push('leap_call');
    }
    
    // Other: always available
    categories.push('other');
    
    return categories.filter(cat => cat !== currentCategory);
  };

  const handleCategorySelect = async (category: OverrideCategory) => {
    // For covered_call and protection, we need to link to a stock
    if (category === 'covered_call' || category === 'protection') {
      setPendingCategory(category);
      setLinkDialogOpen(true);
    } else {
      // For other categories, create override directly
      try {
        await createSingleOverride({
          positionId: option.id,
          targetCategory: category
        });
      } catch (error) {
        console.error('Error creating override:', error);
      }
    }
  };

  const handleLinkConfirm = async (stockId: string) => {
    if (!pendingCategory) return;
    
    try {
      await createSingleOverride({
        positionId: option.id,
        targetCategory: pendingCategory,
        linkedStockId: stockId
      });
      setLinkDialogOpen(false);
      setPendingCategory(null);
    } catch (error) {
      console.error('Error creating override with link:', error);
    }
  };

  const handleRemoveOverride = async () => {
    try {
      await removeOverrideByPositionId(option.id);
    } catch (error) {
      console.error('Error removing override:', error);
    }
  };

  const validCategories = getValidCategories();
  const availableStocks = getAvailableStocks(option.underlying || undefined);
  const contractsNeeded = Math.abs(option.quantity);

  if (validCategories.length === 0 && !existingOverride) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <MoveHorizontal className="h-3.5 w-3.5" />
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Sposta in altra categoria</p>
              </TooltipContent>
            </Tooltip>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {validCategories.map((category) => (
            <DropdownMenuItem
              key={category}
              onClick={() => handleCategorySelect(category)}
              disabled={isCreatingSingle}
            >
              Sposta in {CATEGORY_LABELS[category]}
              {(category === 'covered_call' || category === 'protection') && '...'}
            </DropdownMenuItem>
          ))}
          
          {existingOverride && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleRemoveOverride}
                disabled={isRemoving}
                className="text-destructive focus:text-destructive"
              >
                <X className="h-4 w-4 mr-2" />
                Rimuovi override
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <LinkStockDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        option={option}
        availableStocks={availableStocks}
        contractsNeeded={contractsNeeded}
        onConfirm={handleLinkConfirm}
        isLoading={isCreatingSingle}
      />
    </>
  );
}
