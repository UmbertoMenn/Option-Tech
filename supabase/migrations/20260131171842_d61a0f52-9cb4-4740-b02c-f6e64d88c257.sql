-- Create table for manual derivative classification overrides
CREATE TABLE public.derivative_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  
  -- Override type
  override_type TEXT NOT NULL CHECK (override_type IN ('single', 'multi_leg')),
  
  -- For single overrides
  position_id UUID REFERENCES public.positions(id) ON DELETE CASCADE,
  target_category TEXT CHECK (target_category IN (
    'covered_call', 'protection', 'naked_put', 'leap_call', 'other'
  )),
  linked_stock_id UUID REFERENCES public.positions(id) ON DELETE SET NULL,
  
  -- For multi-leg strategies
  strategy_type TEXT CHECK (strategy_type IN ('iron_condor', 'double_diagonal')),
  sold_put_id UUID REFERENCES public.positions(id) ON DELETE CASCADE,
  bought_put_id UUID REFERENCES public.positions(id) ON DELETE CASCADE,
  sold_call_id UUID REFERENCES public.positions(id) ON DELETE CASCADE,
  bought_call_id UUID REFERENCES public.positions(id) ON DELETE CASCADE,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Constraints for data integrity
  CONSTRAINT valid_single_override CHECK (
    override_type != 'single' OR (position_id IS NOT NULL AND target_category IS NOT NULL)
  ),
  CONSTRAINT valid_multi_leg_override CHECK (
    override_type != 'multi_leg' OR (
      strategy_type IS NOT NULL AND 
      sold_put_id IS NOT NULL AND 
      bought_put_id IS NOT NULL AND
      sold_call_id IS NOT NULL AND 
      bought_call_id IS NOT NULL
    )
  ),
  -- Unique constraint: one override per position (for single) or unique combination (for multi-leg)
  CONSTRAINT unique_single_override UNIQUE (portfolio_id, position_id)
);

-- Create index for faster lookups
CREATE INDEX idx_derivative_overrides_portfolio ON public.derivative_overrides(portfolio_id);
CREATE INDEX idx_derivative_overrides_position ON public.derivative_overrides(position_id) WHERE position_id IS NOT NULL;

-- Enable RLS
ALTER TABLE public.derivative_overrides ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only manage overrides for their own portfolios
CREATE POLICY "Users can view their own overrides"
ON public.derivative_overrides
FOR SELECT
USING (
  portfolio_id IN (
    SELECT id FROM public.portfolios WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert their own overrides"
ON public.derivative_overrides
FOR INSERT
WITH CHECK (
  portfolio_id IN (
    SELECT id FROM public.portfolios WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can update their own overrides"
ON public.derivative_overrides
FOR UPDATE
USING (
  portfolio_id IN (
    SELECT id FROM public.portfolios WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete their own overrides"
ON public.derivative_overrides
FOR DELETE
USING (
  portfolio_id IN (
    SELECT id FROM public.portfolios WHERE user_id = auth.uid()
  )
);

-- Add trigger for updated_at
CREATE TRIGGER update_derivative_overrides_updated_at
BEFORE UPDATE ON public.derivative_overrides
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();