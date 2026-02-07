import React, { useState } from 'react';
import { Move, Check, X, Link } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Position } from '@/types/portfolio';
import { OverrideCategory, OVERRIDE_CATEGORY_LABELS } from '@/types/derivativeOverrides';
import { useDerivativeOverrides } from '@/hooks/useDerivativeOverrides';
import { Badge } from '@/components/ui/badge';

interface MoveOptionMenuProps {
  option: Position;
  availableStocks: Position[];
  currentCategory?: OverrideCategory;
}

export function MoveOptionMenu({ option, availableStocks, currentCategory }: MoveOptionMenuProps) {
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<OverrideCategory | null>(null);
  const [selectedStock, setSelectedStock] = useState<string | null>(null);
  
  const { 
    createSingleOverride, 
    removeOverride, 
    getOverrideForPosition,
    isCreating,
    isRemoving 
  } = useDerivativeOverrides();
  
  const existingOverride = getOverrideForPosition(option.id);
  const hasOverride = !!existingOverride;
  
  // Determine which categories are available based on option type
  const isCall = option.option_type === 'call';
  const isPut = option.option_type === 'put';
  const isSold = option.quantity < 0;
  const isBought = option.quantity > 0;
  
  // Filter available categories based on option characteristics
  const getAvailableCategories = (): OverrideCategory[] => {
    const categories: OverrideCategory[] = [];
    
    // Covered Call: solo CALL vendute
    if (isCall && isSold) {
      categories.push('covered_call');
    }
    
    // Protezione: solo PUT comprate
    if (isPut && isBought) {
      categories.push('protection');
    }
    
    // Naked Put: solo PUT vendute
    if (isPut && isSold) {
      categories.push('naked_put');
    }
    
    // Leap Call: solo CALL comprate
    if (isCall && isBought) {
      categories.push('leap_call');
    }
    
    // Altre strategie: sempre disponibile
    categories.push('other');
    
    return categories;
  };
  
  const availableCategories = getAvailableCategories();
  
  // Check if category requires linking to a stock
  const requiresStockLink = (category: OverrideCategory): boolean => {
    return category === 'covered_call' || category === 'protection';
  };
  
  const handleCategorySelect = async (category: OverrideCategory) => {
    if (requiresStockLink(category)) {
      setSelectedCategory(category);
      setIsLinkDialogOpen(true);
    } else {
      // No stock link needed, create override directly
      await createSingleOverride({
        positionId: option.id,
        targetCategory: category,
      });
    }
  };
  
  const handleConfirmLink = async () => {
    if (!selectedCategory) return;
    
    await createSingleOverride({
      positionId: option.id,
      targetCategory: selectedCategory,
      linkedStockId: selectedStock || undefined,
    });
    
    setIsLinkDialogOpen(false);
    setSelectedCategory(null);
    setSelectedStock(null);
  };
  
  const handleRemoveOverride = async () => {
    await removeOverride(option.id);
  };

  // Filter stocks that might match this option's underlying
  const normalizeForMatching = (name: string): string => {
    return name
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/[^A-Z0-9]/g, '')
      .replace(/(INC|CORP|LTD|LLC|PLC|SA|AG|NV|SPA|ADR|CLASS[A-Z]?)/gi, '')
      .trim();
  };
  
  const optionUnderlying = normalizeForMatching(option.underlying || option.description);
  
  const matchingStocks = availableStocks.filter(stock => {
    const stockName = normalizeForMatching(stock.description || stock.ticker || '');
    const stockTicker = normalizeForMatching(stock.ticker || '');
    return stockName.includes(optionUnderlying) || 
           optionUnderlying.includes(stockName) ||
           stockTicker.includes(optionUnderlying) ||
           optionUnderlying.includes(stockTicker);
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="ghost" 
            size="sm" 
            className={`h-6 w-6 p-0 ${hasOverride ? 'text-blue-500' : 'text-muted-foreground hover:text-foreground'}`}
            title={hasOverride ? 'Override manuale attivo' : 'Sposta in altra categoria'}
          >
            <Move className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Sposta in...
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          {availableCategories.map(category => (
            <DropdownMenuItem
              key={category}
              onClick={() => handleCategorySelect(category)}
              disabled={isCreating}
              className="flex items-center justify-between"
            >
              <span>{OVERRIDE_CATEGORY_LABELS[category]}</span>
              {currentCategory === category && (
                <Check className="h-4 w-4 text-primary" />
              )}
              {requiresStockLink(category) && (
                <Link className="h-3 w-3 text-muted-foreground" />
              )}
            </DropdownMenuItem>
          ))}
          
          {hasOverride && (
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
      
      {/* Dialog for linking to a stock */}
      <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Collega a {selectedCategory === 'covered_call' ? 'Sottostante' : 'Titolo'}
            </DialogTitle>
            <DialogDescription>
              {selectedCategory === 'covered_call' 
                ? 'Seleziona il titolo da coprire con questa CALL venduta.'
                : 'Seleziona il titolo protetto da questa PUT.'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-2">
            <p className="text-sm font-medium mb-2">
              Opzione: {option.description}
            </p>
            
            {matchingStocks.length > 0 ? (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground mb-2">Titoli suggeriti:</p>
                {matchingStocks.map(stock => (
                  <div
                    key={stock.id}
                    onClick={() => setSelectedStock(stock.id)}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedStock === stock.id 
                        ? 'border-primary bg-primary/10' 
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{stock.description}</span>
                      {selectedStock === stock.id && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {stock.quantity} azioni
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground">
                <p className="text-sm">Nessun titolo corrispondente trovato.</p>
                <p className="text-xs mt-1">L'opzione verrà spostata senza collegamento.</p>
              </div>
            )}
            
            {availableStocks.length > matchingStocks.length && (
              <div className="mt-4">
                <p className="text-xs text-muted-foreground mb-2">Altri titoli disponibili:</p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {availableStocks
                    .filter(s => !matchingStocks.some(m => m.id === s.id))
                    .map(stock => (
                      <div
                        key={stock.id}
                        onClick={() => setSelectedStock(stock.id)}
                        className={`p-2 rounded-lg border cursor-pointer transition-colors text-sm ${
                          selectedStock === stock.id 
                            ? 'border-primary bg-primary/10' 
                            : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span>{stock.description}</span>
                          {selectedStock === stock.id && (
                            <Check className="h-4 w-4 text-primary" />
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsLinkDialogOpen(false)}>
              Annulla
            </Button>
            <Button onClick={handleConfirmLink} disabled={isCreating}>
              {selectedStock ? 'Conferma' : 'Sposta senza collegamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Badge to indicate manual override - uses forwardRef for Radix compatibility
export const OverrideBadge = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>((props, ref) => {
  return (
    <Badge 
      ref={ref}
      variant="outline" 
      className="text-[10px] px-1.5 py-0 h-4 bg-blue-500/10 text-blue-500 border-blue-500/30"
      title="Classificazione manuale"
      {...props}
    >
      M
    </Badge>
  );
});
OverrideBadge.displayName = "OverrideBadge";
