

## Fix Avvisi Errati: Escludere Gambe Strategie Multi-Leg

### Problema Identificato
La Edge Function `check-alerts` tratta ogni opzione come posizione singola, senza riconoscere le strategie multi-leg. Questo causa:
- Avvisi **LEAP WESTERN** errati per Long Call che fanno parte di Double Diagonal
- Avvisi **Naked Put ITM ALIBABA** errati per Short Put che fanno parte di Put Broken Wing Butterfly

### Soluzione
Replicare la logica di categorizzazione di `derivativeStrategies.ts` nella Edge Function per identificare **tutte** le strategie e generare avvisi appropriati.

---

### Strategia Implementativa

#### 1. Identificare le strategie nell'ordine corretto

La Edge Function dovra' seguire la stessa sequenza del frontend:
1. **Covered Call** - CALL vendute con stock in portafoglio
2. **Protezioni** - PUT comprate con stock in portafoglio
3. **Iron Condor** - 4 gambe stessa scadenza
4. **Double Diagonal** - 4 gambe scadenze diverse
5. **Altre Strategie** - gruppi di 2+ opzioni sullo stesso sottostante (Short Strangle, Broken Wing Butterfly, Spread, ecc.)
6. **Singole gambe** - solo le posizioni rimaste vengono trattate come Naked Put o LEAP

#### 2. Mantenere un Set di position ID usati

```typescript
const usedPositionIds = new Set<string>();

// Step 1-5: Categorizza strategie e aggiungi ID usati al Set
// ...

// Step 6: Processa solo posizioni NON usate
for (const option of optionPositions) {
  if (usedPositionIds.has(option.id)) continue; // SKIP!
  // ... logica Naked Put ITM, LEAP gain, distanza
}
```

#### 3. Nuovi tipi di avviso per strategie

| Strategia | Alert Stato | Alert Distanza |
|-----------|-------------|----------------|
| Iron Condor | OOR (fuori range venduto) | Distanza dal PUT/CALL venduto |
| Double Diagonal | OOR (fuori range venduto) | Distanza dal PUT/CALL venduto |
| Alternative DD | OOR (fuori range venduto) | Distanza dal PUT/CALL venduto |
| Short Strangle | OOR (fuori range venduto) | Distanza dal PUT/CALL venduto |
| Put/Call Spread | OOR (fuori range) | Distanza dallo strike venduto |
| Altre strategie (IB/OOB) | OOB (fuori breakeven) | - |

---

### Modifiche Tecniche Dettagliate

#### 1. Aggiungere funzioni di categorizzazione alla Edge Function

```typescript
// Normalizzazione stringhe (stessa logica frontend)
function normalizeForMatching(str: string): string { ... }

// Raggruppare opzioni per sottostante
function groupByUnderlying(options: Position[]): Map<string, Position[]> { ... }

// Riconoscere Iron Condor (4 gambe stessa scadenza)
function tryMatchIronCondor(group: Position[]): IronCondor | null { ... }

// Riconoscere Double Diagonal (4 gambe scadenze diverse)
function tryMatchDoubleDiagonal(group: Position[]): DoubleDiagonal | null { ... }

// Riconoscere Short Strangle, Spread, Butterfly ecc.
function detectStrategyName(group: Position[]): string | null { ... }
```

#### 2. Nuova logica di processamento

```typescript
// PRIMA di processare singole opzioni:

// Step 1: Raggruppa per sottostante
const optionsByUnderlying = groupByUnderlying(optionPositions);

// Step 2: Identifica Covered Call
for (const option of optionPositions) {
  if (option.option_type === 'call' && option.quantity < 0) {
    const hasStock = stockPositions.some(s => matchUnderlying(s, option));
    if (hasStock) {
      usedPositionIds.add(option.id);
      // Genera avvisi CC come prima
    }
  }
}

// Step 3-4: Identifica Iron Condor e Double Diagonal
for (const [underlying, group] of optionsByUnderlying) {
  const ic = tryMatchIronCondor(group);
  if (ic) {
    usedPositionIds.add(ic.soldPut.id);
    usedPositionIds.add(ic.boughtPut.id);
    usedPositionIds.add(ic.soldCall.id);
    usedPositionIds.add(ic.boughtCall.id);
    // Genera avvisi OOR e distanza per IC
    continue;
  }
  
  const dd = tryMatchDoubleDiagonal(group);
  if (dd) {
    usedPositionIds.add(...);
    // Genera avvisi OOR e distanza per DD
  }
}

// Step 5: Identifica Altre Strategie (2+ opzioni)
for (const [underlying, group] of optionsByUnderlying) {
  const remaining = group.filter(o => !usedPositionIds.has(o.id));
  if (remaining.length >= 2) {
    const strategyName = detectStrategyName(remaining);
    
    // Marca tutte le opzioni come usate
    remaining.forEach(o => usedPositionIds.add(o.id));
    
    // Genera avvisi basati sul tipo di strategia
    if (strategyName === 'Short Strangle' || strategyName === 'Alternative Double Diagonal') {
      // Logica OOR + distanza da strike venduti
    } else {
      // Logica OOB basata su breakeven (per Butterfly, Spread, ecc.)
    }
  }
}

// Step 6: Processa SOLO posizioni singole rimaste
for (const option of optionPositions) {
  if (usedPositionIds.has(option.id)) continue;
  
  // Ora qui arrivano SOLO vere Naked Put e vere LEAP Call
  // ... logica esistente per ITM, distanza, LEAP gain
}
```

#### 3. Calcolo OOB per strategie con breakeven

Per strategie come Broken Wing Butterfly, calcolare il payoff a scadenza:

```typescript
function calculateBreakevens(options: Position[]): number[] {
  // Simula il payoff a vari prezzi sottostante
  // Trova i punti dove il payoff attraversa lo zero
  return breakevens;
}

function isOutOfBreakeven(underlyingPrice: number, breakevens: number[]): boolean {
  if (breakevens.length >= 2) {
    return underlyingPrice < Math.min(...breakevens) || 
           underlyingPrice > Math.max(...breakevens);
  }
  // ... logica per singolo breakeven
}
```

---

### Tipi Alert da Aggiungere al Database

Prima di implementare, verificare se servono nuovi tipi:
- `action_strategy_oor` - Strategia Out of Range (per IC, DD, Strangle)
- `action_strategy_oob` - Strategia Out of Breakeven (per Butterfly, Spread)
- `distance_strategy_put` - Distanza da PUT venduta (strategie)
- `distance_strategy_call` - Distanza da CALL venduta (strategie)

I tipi `action_dd_ic_oor` e `action_strategy_oob` esistono gia' nel database.

---

### File da Modificare

| File | Modifica |
|------|----------|
| `supabase/functions/check-alerts/index.ts` | Aggiungere logica categorizzazione, modificare flusso processamento |
| Migrazione SQL (se necessaria) | Nuovi tipi alert nel ENUM |

---

### Risultato Atteso

Dopo l'implementazione:

| Sottostante | Strategia Frontend | Avviso Generato |
|-------------|-------------------|-----------------|
| WESTERN DIGITAL | Double Diagonal | OOR/Distanza DD (NO avvisi LEAP) |
| ALIBABA | Put Broken Wing Butterfly | OOB (NO avvisi Naked Put ITM) |
| RIGETTI | Naked Put (singola) | Naked Put ITM (corretto) |

---

### Stima Complessita'

La modifica richiede di portare circa 300+ righe di logica dal frontend (`derivativeStrategies.ts`) alla Edge Function, includendo:
- Funzioni di normalizzazione e matching
- Riconoscimento strategie 4-leg
- Riconoscimento strategie 2-3 leg (Strangle, Spread, Butterfly)
- Calcolo breakeven per OOB
- Logica OOR per strategie con strike venduti

Questa e' una modifica sostanziale ma necessaria per garantire la correttezza del sistema di avvisi.

