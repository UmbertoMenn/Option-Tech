

# Piano: Priorità classificazione singole gambe prima del raggruppamento

## Problema Identificato
La logica attuale (step 5 nel file `derivativeStrategies.ts`) raggruppa tutte le opzioni dello stesso sottostante in "Altre Strategie" quando ce n'è più di una, anche se queste opzioni:
- Hanno scadenze diverse
- Non formano una strategia riconosciuta
- Potrebbero essere classificate singolarmente come Protezioni o Naked Put

## Soluzione Proposta
Modificare l'ordine di priorità della classificazione: **verificare prima se ogni singola opzione soddisfa i criteri per una categoria specifica** (Protezione, Naked Put), e solo dopo raggruppare le rimanenti in "Altre Strategie".

---

## Nuova Logica di Classificazione

### Ordine di priorità aggiornato:

1. **Covered Call** (invariato) - CALL vendute coperte da azioni
2. **Protezioni - Long Put** (invariato per protezione totale)
3. **Iron Condor** (invariato) - 4 gambe stessa scadenza
4. **Double Diagonal** (invariato) - 4 gambe con scadenze diverse
5. **PUT vendute singole → Naked Put** (NUOVO: prima del raggruppamento)
6. **PUT comprate con sottostante → Protezione parziale** (NUOVO: prima del raggruppamento)
7. **CALL comprate → Leap Call** (NUOVO: prima del raggruppamento)
8. **Altre Strategie** - Solo opzioni rimanenti che formano effettivamente una strategia multi-gamba

---

## Modifiche al Codice

### File: `src/lib/derivativeStrategies.ts`

**Modifica Step 5-6 (righe 265-339):**

Sostituire la logica attuale con:

```text
// STEP 5: Classificazione singole gambe PRIMA del raggruppamento
const afterFourLegRemaining = derivatives.filter(d => !usedDerivatives.has(d.id));

for (const option of afterFourLegRemaining) {
  const underlyingStock = findUnderlyingStock(option, stockPositions);
  const underlyingKey = normalizeForMatching(option.underlying || option.description);
  
  // 5a. PUT comprata con sottostante → Protezione parziale
  if (option.option_type === 'put' && option.quantity > 0) {
    const candidate = partialProtectionCandidates.get(underlyingKey);
    if (candidate && candidate.puts.some(p => p.id === option.id)) {
      longPuts.push({
        option,
        underlying: candidate.stock,
        contracts: option.quantity,
        isPartial: true
      });
      usedDerivatives.add(option.id);
      continue;
    }
  }
  
  // 5b. PUT venduta → Naked Put
  if (option.option_type === 'put' && option.quantity < 0) {
    nakedPuts.push({
      option,
      underlying: underlyingStock || null,
      contracts: Math.abs(option.quantity)
    });
    usedDerivatives.add(option.id);
    continue;
  }
  
  // 5c. CALL comprata → Leap Call
  if (option.option_type === 'call' && option.quantity > 0) {
    leapCalls.push({
      option,
      underlying: underlyingStock || null,
      contracts: option.quantity
    });
    usedDerivatives.add(option.id);
    continue;
  }
}

// STEP 6: Altre Strategie - solo opzioni rimanenti non classificate
const finalRemaining = derivatives.filter(d => !usedDerivatives.has(d.id));

for (const option of finalRemaining) {
  const underlyingStock = findUnderlyingStock(option, stockPositions);
  otherStrategies.push({
    option,
    underlying: underlyingStock || null
  });
  usedDerivatives.add(option.id);
}
```

---

## Risultato Atteso

Con la nuova logica, le opzioni Google verranno classificate così:

| Opzione | Classificazione Attuale | Classificazione Nuova |
|---------|------------------------|----------------------|
| CALL venduta 290 | Covered Call | Covered Call |
| CALL venduta 350 | Covered Call | Covered Call |
| PUT comprata 220 dic/27 | Altre Strategie | **Protezione parziale** (P!) |
| PUT venduta 295 feb/26 | Altre Strategie | **Naked Put** |

---

## Dettagli Tecnici

### Logica Protezione Parziale

La PUT comprata 220 verrà classificata come protezione parziale perché:
1. Possiedi il sottostante (Google)
2. L'esposizione netta è > 0 (hai 2 covered call, quindi almeno 200 azioni, ma la PUT 220 copre solo 100)

### Rimozione Step Raggruppamento Multi-Gamba

Il vecchio codice (righe 278-290) che forzava il raggruppamento quando `group.length > 1` verrà rimosso. Le opzioni verranno raggruppate in "Altre Strategie" solo se:
- Non sono PUT vendute (→ Naked Put)
- Non sono PUT comprate con sottostante (→ Protezione)
- Non sono CALL comprate (→ Leap Call)
- Non sono già state usate in strategie a 4 gambe

