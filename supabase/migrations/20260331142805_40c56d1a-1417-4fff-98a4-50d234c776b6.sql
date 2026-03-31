ALTER TABLE public.strategy_configurations 
ADD COLUMN linked_stock_slot_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill existing records: if linked_stock_id is set, put it in the array
UPDATE public.strategy_configurations 
SET linked_stock_slot_ids = jsonb_build_array(linked_stock_id::text)
WHERE linked_stock_id IS NOT NULL;