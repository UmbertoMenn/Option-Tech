

## Fix 7 Call ALPHABET Non Coperte -- Usare getCanonicalKey

### Problema

La funzione `normalizeForMatching` produce chiavi diverse per lo stesso sottostante:

| Posizione | Normalizzata | Chiave |
|-----------|-------------|--------|
| `ALPHABET INC` (stock) | `ALPHABET` | ALPHABET |
| `AZ.ALPHABET INC-CL A` (stock) | `ALPHABET CL A` | ALPHABET CL A |
| `AZ.ALPHABET INC-CL C` (stock) | `ALPHABET CL C` | ALPHABET CL C |
| `GOOGLE INC. (A)` (opzione) | `GOOGLE` | GOOGLE |
| `GOOGLE INC. (C)` (opzione) | `GOOGLE` | GOOGLE |

Risultato: le azioni finiscono in 3 bucket separati ("ALPHABET", "ALPHABET CL A", "ALPHABET CL C"), le call vendute in un quarto ("GOOGLE"). Nessun bucket ha sia azioni che call, quindi tutte le call risultano "non coperte".

Il sistema `SPECIAL_ALIASES` in `derivativeStrategies.ts` gia gestisce GOOGLE = ALPHABET, ma la card **non lo usa**.

Un secondo problema: "CL A" e "CL C" non vengono rimossi (la regex rimuove solo "CLASS A", non "CL A"), frammentando ulteriormente le azioni.

### Soluzione

Due modifiche:

1. **Nella card** (`DerivativesSummaryCard.tsx`): sostituire ogni chiamata a `normalizeForMatching(...)` con una nuova funzione helper locale che prima prova `getCanonicalKey(text)` e, se non trova un alias, ricade su `normalizeForMatching(text)`. Questo unifica GOOGLE e ALPHABET in un unico bucket.

2. **Nella funzione `normalizeForMatching`** (`derivativeStrategies.ts`): aggiungere `CL` alla lista dei suffissi rimossi nel regex, cosi "ALPHABET CL A" e "ALPHABET CL C" diventano entrambi "ALPHABET".

### File modificati

| File | Modifica |
|------|----------|
| `src/lib/derivativeStrategies.ts` | Aggiungere `CL` alla regex dei suffissi in `normalizeForMatching` |
| `src/components/derivatives/DerivativesSummaryCard.tsx` | Importare `getCanonicalKey` e creare una funzione helper `getMatchingKey(text)` che usa `getCanonicalKey` con fallback su `normalizeForMatching`. Usarla al posto di `normalizeForMatching` in tutto il calcolo uncovered calls |

### Risultato atteso

Dopo la modifica:
- Tutte le azioni ALPHABET (900 totali) finiscono nel bucket "ALPHABET" (9 contratti coperti)
- Tutte le call vendute GOOGLE finiscono nello stesso bucket "ALPHABET"
- Le 9 call vendute sono tutte coperte dalle 900 azioni
- Il conteggio call non coperte per ALPHABET/GOOGLE passa da 7 a 0

