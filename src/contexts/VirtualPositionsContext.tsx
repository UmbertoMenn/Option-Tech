/**
 * VirtualPositionsContext — sostituisce le posizioni restituite da usePortfolio() per
 * tutto il sottoalbero (pagina Portafoglio virtuale). Fuori dal provider il contesto è
 * null e usePortfolio() resta invariato: nessun altro schermo vede le posizioni virtuali.
 *
 * Opzionalmente sostituisce anche la liquidità (patrimonio simulato) ed esclude la
 * Gestione Patrimoniale reale.
 */
import { createContext, useContext } from 'react';
import { Position } from '@/types/portfolio';

export interface VirtualPositionsValue {
  positions: Position[];
  /** Liquidità simulata (EUR). null/undefined = liquidità reale. */
  cashValue?: number | null;
  /** true = la GP reale non entra nel portafoglio virtuale. */
  excludeGP?: boolean;
}

export const VirtualPositionsContext = createContext<VirtualPositionsValue | null>(null);

export const useVirtualPositionsOverride = () => useContext(VirtualPositionsContext);
