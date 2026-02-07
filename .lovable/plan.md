

# Piano: Matching Intelligente Override dopo Upload Excel

## Panoramica del Problema

Quando viene caricato un nuovo Excel:
1. **Tutte le posizioni esistenti vengono eliminate** (`DELETE FROM positions WHERE portfolio_id = ?`)
2. **Nuove posizioni vengono create con nuovi UUID**
3. **Gli override in `derivative_overrides` diventano orfani** (puntano a position_id non più esistenti)
4. **La `strategy_cache` contiene position_ids obsoleti** (si auto-corregge ma rimane temporaneamente inconsistente)

### Impatto sull'Utente
- L'utente sposta manualmente un'opzione in una categoria (es. "Covered Call")
- Carica un nuovo Excel con le stesse posizioni (magari con prezzi aggiornati)
- **Tutto il lavoro manuale viene perso** perché gli override ora puntano a UUID inesistenti

---

## Soluzione: Matching Intelligente Post-Upload

### Logica di Matching

Creare una "firma" univoca per ogni opzione basata su attributi stabili:
```
signature = underlying + strike + expiry_date + option_type + quantity
```

**Esempio:**
```
IREN_25.00_2025-06-20_call_-3
```

Questa firma rimane identica tra upload se l'opzione non è cambiata strutturalmente.

---

## Architettura della Soluzione

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                           FLUSSO UPLOAD                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. Excel Upload Inizia                                                 │
│           │                                                             │
│           ▼                                                             │
│  2. PRIMA del DELETE: Leggi posizioni esistenti + overrides             │
│     ┌─────────────────────────────────────────────────────────┐        │
│     │ Per ogni override:                                       │        │
│     │   - Trova posizione corrispondente (position_id)         │        │
│     │   - Genera FIRMA: underlying|strike|expiry|type|qty      │        │
│     │   - Salva mappa: { firma → override_data }               │        │
│     └─────────────────────────────────────────────────────────┘        │
│           │                                                             │
│           ▼                                                             │
│  3. DELETE + INSERT nuove posizioni (come oggi)                        │
│           │                                                             │
│           ▼                                                             │
│  4. DOPO l'INSERT: Matching intelligente                                │
│     ┌─────────────────────────────────────────────────────────┐        │
│     │ Per ogni override memorizzato (mappa firme):             │        │
│     │   - Cerca nuova posizione con stessa FIRMA               │        │
│     │   - Se trovata → UPDATE override con nuovo position_id   │        │
│     │   - Se NON trovata → DELETE override orfano              │        │
│     └─────────────────────────────────────────────────────────┘        │
│           │                                                             │
│           ▼                                                             │
│  5. Invalidate query cache                                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementazione Dettagliata

### 1. Nuovo Helper: `generatePositionSignature`

**File**: `src/lib/overrideMatching.ts` (nuovo file)

```typescript
export interface PositionSignature {
  underlying: string;
  strike: number;
  expiry: string;
  optionType: 'call' | 'put';
  quantity: number;
}

export function generatePositionSignature(position: Position): string | null {
  if (position.asset_type !== 'derivative') return null;
  if (!position.underlying || !position.strike_price || !position.expiry_date || !position.option_type) {
    return null;
  }
  
  // Normalizza underlying (rimuovi spazi, uppercase)
  const underlying = normalizeUnderlying(position.underlying);
  
  return `${underlying}|${position.strike_price}|${position.expiry_date}|${position.option_type}|${position.quantity}`;
}

function normalizeUnderlying(underlying: string): string {
  return underlying.toUpperCase().trim().replace(/\s+/g, '_');
}
```

### 2. Nuova Funzione: `remapOverridesAfterUpload`

**File**: `src/lib/overrideMatching.ts`

```typescript
export interface OverrideRemapResult {
  matched: number;    // Override aggiornati con successo
  orphaned: number;   // Override eliminati (nessun match)
  unchanged: number;  // Override già validi
}

export async function remapOverridesAfterUpload(
  portfolioId: string,
  oldPositions: Position[],
  newPositions: Position[],
  overrides: DerivativeOverride[]
): Promise<OverrideRemapResult> {
  // 1. Crea mappa: old_position_id → signature
  const oldSignatures = new Map<string, string>();
  for (const pos of oldPositions) {
    const sig = generatePositionSignature(pos);
    if (sig) oldSignatures.set(pos.id, sig);
  }
  
  // 2. Crea mappa inversa: signature → new_position_id
  const newPositionsBySignature = new Map<string, string>();
  for (const pos of newPositions) {
    const sig = generatePositionSignature(pos);
    if (sig) newPositionsBySignature.set(sig, pos.id);
  }
  
  // 3. Processa ogni override
  let matched = 0;
  let orphaned = 0;
  let unchanged = 0;
  
  for (const override of overrides) {
    if (override.override_type === 'single' && override.position_id) {
      // Trova signature dell'override
      const oldSig = oldSignatures.get(override.position_id);
      if (!oldSig) {
        orphaned++;
        await deleteOverride(override.id);
        continue;
      }
      
      // Cerca nuovo position_id con stessa signature
      const newPositionId = newPositionsBySignature.get(oldSig);
      if (newPositionId) {
        if (newPositionId !== override.position_id) {
          await updateOverridePositionId(override.id, newPositionId, override.linked_stock_id);
          matched++;
        } else {
          unchanged++;
        }
      } else {
        orphaned++;
        await deleteOverride(override.id);
      }
    } else if (override.override_type === 'multi_leg') {
      // Gestisci override multi-leg (4 position_id da rimappare)
      const result = await remapMultiLegOverride(override, oldSignatures, newPositionsBySignature);
      if (result === 'matched') matched++;
      else if (result === 'orphaned') orphaned++;
      else unchanged++;
    }
  }
  
  return { matched, orphaned, unchanged };
}
```

### 3. Gestione `linked_stock_id`

Per gli override che collegano un'opzione a uno specifico titolo azionario:
- Cercare lo stock nella nuova lista usando `description` o `ticker`
- Se trovato → aggiornare `linked_stock_id`
- Se non trovato → rimuovere il link (l'override rimane ma senza stock specifico)

```typescript
function findMatchingStock(
  oldStockId: string | null,
  oldPositions: Position[],
  newPositions: Position[]
): string | null {
  if (!oldStockId) return null;
  
  const oldStock = oldPositions.find(p => p.id === oldStockId);
  if (!oldStock) return null;
  
  // Cerca per ISIN (più affidabile)
  if (oldStock.isin) {
    const match = newPositions.find(p => p.isin === oldStock.isin && p.asset_type === 'stock');
    if (match) return match.id;
  }
  
  // Fallback: cerca per ticker
  if (oldStock.ticker) {
    const match = newPositions.find(p => p.ticker === oldStock.ticker && p.asset_type === 'stock');
    if (match) return match.id;
  }
  
  // Fallback: cerca per description normalizzata
  const oldDesc = oldStock.description.toUpperCase();
  const match = newPositions.find(p => 
    p.asset_type === 'stock' && 
    p.description.toUpperCase() === oldDesc
  );
  
  return match?.id || null;
}
```

### 4. Modifica `updatePositionsMutation` in `usePortfolio.ts`

**File**: `src/hooks/usePortfolio.ts`

```typescript
const updatePositionsMutation = useMutation({
  mutationFn: async ({ positions, targetPortfolioId }) => {
    const portfolioId = targetPortfolioId || portfolio?.id;
    if (!portfolioId) throw new Error('Portfolio non trovato');
    
    // ========= STEP 0: Leggi stato attuale PRIMA del delete =========
    const { data: oldPositions } = await supabase
      .from('positions')
      .select('*')
      .eq('portfolio_id', portfolioId);
    
    const { data: existingOverrides } = await supabase
      .from('derivative_overrides')
      .select('*')
      .eq('portfolio_id', portfolioId);
    
    // ========= STEP 1: Delete + Insert (come oggi) =========
    const { error: deleteError } = await supabase
      .from('positions')
      .delete()
      .eq('portfolio_id', portfolioId);
    
    if (deleteError) throw deleteError;
    
    const { data: insertedPositions, error } = await supabase
      .from('positions')
      .insert(positions.map(p => ({ ...p, portfolio_id: portfolioId })))
      .select(); // ← IMPORTANTE: ritorna le nuove posizioni con i nuovi ID
    
    if (error) throw error;
    
    // ========= STEP 2: Remappa override =========
    if (existingOverrides && existingOverrides.length > 0 && insertedPositions) {
      const result = await remapOverridesAfterUpload(
        portfolioId,
        oldPositions || [],
        insertedPositions,
        existingOverrides
      );
      
      console.log('[OverrideRemap] Result:', result);
      
      if (result.matched > 0) {
        toast.info(`Override preservati: ${result.matched}`, {
          description: result.orphaned > 0 
            ? `${result.orphaned} override non più validi rimossi.`
            : undefined
        });
      }
    }
    
    // ========= STEP 3: Update portfolio totals (come oggi) =========
    // ... existing code ...
    
    return insertedPositions;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['positions'] });
    queryClient.invalidateQueries({ queryKey: ['portfolios'] });
    queryClient.invalidateQueries({ queryKey: ['derivative-overrides'] }); // ← NUOVO
  },
});
```

---

## File Coinvolti

| File | Modifiche |
|------|-----------|
| `src/lib/overrideMatching.ts` | **NUOVO** - Funzioni di matching e remapping |
| `src/hooks/usePortfolio.ts` | Modifica `updatePositionsMutation` per eseguire il remapping |
| `src/types/derivativeOverrides.ts` | Nessuna modifica necessaria |

---

## Gestione Override Multi-Leg

Per strategie come Iron Condor e Double Diagonal (4 gambe):

```typescript
async function remapMultiLegOverride(
  override: DerivativeOverride,
  oldSignatures: Map<string, string>,
  newPositionsBySignature: Map<string, string>
): Promise<'matched' | 'orphaned' | 'unchanged'> {
  const legIds = [
    override.sold_put_id,
    override.bought_put_id,
    override.sold_call_id,
    override.bought_call_id
  ].filter(Boolean) as string[];
  
  const newLegIds: (string | null)[] = [];
  let allMatched = true;
  
  for (const oldId of legIds) {
    const oldSig = oldSignatures.get(oldId);
    if (!oldSig) {
      allMatched = false;
      break;
    }
    
    const newId = newPositionsBySignature.get(oldSig);
    if (!newId) {
      allMatched = false;
      break;
    }
    newLegIds.push(newId);
  }
  
  if (!allMatched) {
    // Se una qualsiasi gamba non ha match, elimina l'intera strategia
    await supabase.from('derivative_overrides').delete().eq('id', override.id);
    return 'orphaned';
  }
  
  // Verifica se qualcosa è cambiato
  const unchanged = legIds.every((oldId, i) => oldId === newLegIds[i]);
  if (unchanged) return 'unchanged';
  
  // Aggiorna tutti i leg_id
  await supabase
    .from('derivative_overrides')
    .update({
      sold_put_id: newLegIds[0],
      bought_put_id: newLegIds[1],
      sold_call_id: newLegIds[2],
      bought_call_id: newLegIds[3],
      updated_at: new Date().toISOString()
    })
    .eq('id', override.id);
  
  return 'matched';
}
```

---

## Gestione `strategy_cache`

La `strategy_cache` si auto-corregge automaticamente:
- Viene cancellata e ricreata ogni volta che l'utente visita la pagina Derivati
- Non richiede remapping esplicito

**Nota**: Dopo il remapping degli override, quando l'utente visita la pagina Derivati, la cache verrà rigenerata correttamente utilizzando i nuovi position_id già aggiornati negli override.

---

## Edge Cases

| Scenario | Comportamento |
|----------|---------------|
| Opzione cambia quantità (es. -3 → -2) | Override **non** preservato (signature diversa) |
| Opzione cambia strike | Override **non** preservato |
| Opzione cambia scadenza | Override **non** preservato |
| Solo prezzo cambia | Override **preservato** (prezzo non è nella firma) |
| Stock linkato non più presente | Override preservato, `linked_stock_id` = null |
| Strategia multi-leg perde una gamba | Override **eliminato** (strategia incompleta) |

---

## Feedback Utente

Dopo il remapping, mostrare un toast informativo:

- ✅ **"6 override preservati"** - quando tutto va bene
- ⚠️ **"4 override preservati, 2 rimossi"** - quando alcune opzioni sono cambiate
- ℹ️ Nessun messaggio se non c'erano override

---

## Vantaggi della Soluzione

1. **Trasparente per l'utente**: Il lavoro manuale viene preservato automaticamente
2. **Robusto**: Funziona anche se l'ordine delle posizioni cambia
3. **Sicuro**: Override non più validi vengono puliti automaticamente
4. **Retrocompatibile**: Nessuna modifica al database schema necessaria
5. **Efficiente**: Il matching avviene in memoria, poche query DB aggiuntive

