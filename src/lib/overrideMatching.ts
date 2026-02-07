import { supabase } from '@/integrations/supabase/client';
import { Position } from '@/types/portfolio';
import { DerivativeOverride } from '@/types/derivativeOverrides';

/**
 * Generates a unique signature for a derivative position based on stable attributes.
 * This signature remains identical between uploads if the option hasn't structurally changed.
 * 
 * Format: UNDERLYING|STRIKE|EXPIRY|OPTION_TYPE|QUANTITY
 * Example: IREN|25.00|2025-06-20|call|-3
 */
export function generatePositionSignature(position: Position): string | null {
  if (position.asset_type !== 'derivative') return null;
  if (!position.underlying || !position.strike_price || !position.expiry_date || !position.option_type) {
    return null;
  }
  
  const underlying = normalizeUnderlying(position.underlying);
  
  return `${underlying}|${position.strike_price}|${position.expiry_date}|${position.option_type}|${position.quantity}`;
}

function normalizeUnderlying(underlying: string): string {
  return underlying.toUpperCase().trim().replace(/\s+/g, '_');
}

export interface OverrideRemapResult {
  matched: number;    // Override successfully updated
  orphaned: number;   // Override deleted (no match found)
  unchanged: number;  // Override already valid
}

/**
 * Remaps derivative overrides after a new Excel upload.
 * Uses position signatures to match old positions with new ones and update override references.
 */
export async function remapOverridesAfterUpload(
  portfolioId: string,
  oldPositions: Position[],
  newPositions: Position[],
  overrides: DerivativeOverride[]
): Promise<OverrideRemapResult> {
  // 1. Create map: old_position_id → signature
  const oldSignatures = new Map<string, string>();
  for (const pos of oldPositions) {
    const sig = generatePositionSignature(pos);
    if (sig) oldSignatures.set(pos.id, sig);
  }
  
  // 2. Create inverse map: signature → new_position_id
  const newPositionsBySignature = new Map<string, string>();
  for (const pos of newPositions) {
    const sig = generatePositionSignature(pos);
    if (sig) newPositionsBySignature.set(sig, pos.id);
  }
  
  // 3. Process each override
  let matched = 0;
  let orphaned = 0;
  let unchanged = 0;
  
  for (const override of overrides) {
    if (override.override_type === 'single' && override.position_id) {
      const result = await remapSingleOverride(
        override,
        oldPositions,
        newPositions,
        oldSignatures,
        newPositionsBySignature
      );
      
      if (result === 'matched') matched++;
      else if (result === 'orphaned') orphaned++;
      else unchanged++;
    } else if (override.override_type === 'multi_leg') {
      const result = await remapMultiLegOverride(
        override,
        oldSignatures,
        newPositionsBySignature
      );
      
      if (result === 'matched') matched++;
      else if (result === 'orphaned') orphaned++;
      else unchanged++;
    }
  }
  
  return { matched, orphaned, unchanged };
}

/**
 * Remaps a single override (one option moved to a category)
 */
async function remapSingleOverride(
  override: DerivativeOverride,
  oldPositions: Position[],
  newPositions: Position[],
  oldSignatures: Map<string, string>,
  newPositionsBySignature: Map<string, string>
): Promise<'matched' | 'orphaned' | 'unchanged'> {
  if (!override.position_id) return 'orphaned';
  
  // Find signature for this override's position
  const oldSig = oldSignatures.get(override.position_id);
  if (!oldSig) {
    // Position not found in old positions, delete orphan
    await deleteOverride(override.id);
    return 'orphaned';
  }
  
  // Find new position with same signature
  const newPositionId = newPositionsBySignature.get(oldSig);
  if (!newPositionId) {
    // No matching position in new upload, delete orphan
    await deleteOverride(override.id);
    return 'orphaned';
  }
  
  // Check if position_id changed
  if (newPositionId === override.position_id) {
    return 'unchanged';
  }
  
  // Also remap linked_stock_id if present
  const newLinkedStockId = findMatchingStock(
    override.linked_stock_id || null,
    oldPositions,
    newPositions
  );
  
  // Update override with new position_id (and linked_stock_id if applicable)
  await updateOverridePositionId(override.id, newPositionId, newLinkedStockId);
  return 'matched';
}

/**
 * Remaps a multi-leg override (Iron Condor, Double Diagonal with 4 legs)
 */
async function remapMultiLegOverride(
  override: DerivativeOverride,
  oldSignatures: Map<string, string>,
  newPositionsBySignature: Map<string, string>
): Promise<'matched' | 'orphaned' | 'unchanged'> {
  // Collect all leg IDs that exist
  const legMapping: { field: keyof DerivativeOverride; oldId: string | null }[] = [
    { field: 'sold_put_id', oldId: override.sold_put_id || null },
    { field: 'bought_put_id', oldId: override.bought_put_id || null },
    { field: 'sold_call_id', oldId: override.sold_call_id || null },
    { field: 'bought_call_id', oldId: override.bought_call_id || null },
  ];
  
  const activeLegMappings = legMapping.filter(l => l.oldId !== null);
  
  if (activeLegMappings.length === 0) {
    // No legs, invalid override
    await deleteOverride(override.id);
    return 'orphaned';
  }
  
  const newLegIds: Record<string, string | null> = {};
  let allMatched = true;
  let anyChanged = false;
  
  for (const leg of activeLegMappings) {
    const oldSig = oldSignatures.get(leg.oldId!);
    if (!oldSig) {
      allMatched = false;
      break;
    }
    
    const newId = newPositionsBySignature.get(oldSig);
    if (!newId) {
      allMatched = false;
      break;
    }
    
    newLegIds[leg.field] = newId;
    if (newId !== leg.oldId) {
      anyChanged = true;
    }
  }
  
  if (!allMatched) {
    // If any leg doesn't have a match, delete the entire strategy
    await deleteOverride(override.id);
    return 'orphaned';
  }
  
  if (!anyChanged) {
    return 'unchanged';
  }
  
  // Update all leg IDs
  const updateData: Record<string, string | null> = {
    updated_at: new Date().toISOString(),
  };
  
  if (newLegIds.sold_put_id !== undefined) updateData.sold_put_id = newLegIds.sold_put_id;
  if (newLegIds.bought_put_id !== undefined) updateData.bought_put_id = newLegIds.bought_put_id;
  if (newLegIds.sold_call_id !== undefined) updateData.sold_call_id = newLegIds.sold_call_id;
  if (newLegIds.bought_call_id !== undefined) updateData.bought_call_id = newLegIds.bought_call_id;
  
  await supabase
    .from('derivative_overrides')
    .update(updateData)
    .eq('id', override.id);
  
  return 'matched';
}

/**
 * Finds a matching stock in the new positions list based on the old stock
 */
function findMatchingStock(
  oldStockId: string | null,
  oldPositions: Position[],
  newPositions: Position[]
): string | null {
  if (!oldStockId) return null;
  
  const oldStock = oldPositions.find(p => p.id === oldStockId);
  if (!oldStock) return null;
  
  // Try to match by ISIN (most reliable)
  if (oldStock.isin) {
    const match = newPositions.find(p => p.isin === oldStock.isin && p.asset_type === 'stock');
    if (match) return match.id;
  }
  
  // Fallback: match by ticker
  if (oldStock.ticker) {
    const match = newPositions.find(p => p.ticker === oldStock.ticker && p.asset_type === 'stock');
    if (match) return match.id;
  }
  
  // Fallback: match by normalized description
  const oldDesc = oldStock.description.toUpperCase().trim();
  const match = newPositions.find(p => 
    p.asset_type === 'stock' && 
    p.description.toUpperCase().trim() === oldDesc
  );
  
  return match?.id || null;
}

/**
 * Deletes an orphaned override
 */
async function deleteOverride(overrideId: string): Promise<void> {
  await supabase
    .from('derivative_overrides')
    .delete()
    .eq('id', overrideId);
}

/**
 * Updates an override with a new position_id (and optionally linked_stock_id)
 */
async function updateOverridePositionId(
  overrideId: string,
  newPositionId: string,
  newLinkedStockId: string | null
): Promise<void> {
  const updateData: Record<string, string | null> = {
    position_id: newPositionId,
    updated_at: new Date().toISOString(),
  };
  
  // Always update linked_stock_id (even if null, to clear stale references)
  updateData.linked_stock_id = newLinkedStockId;
  
  await supabase
    .from('derivative_overrides')
    .update(updateData)
    .eq('id', overrideId);
}
