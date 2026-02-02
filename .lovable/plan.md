
# Piano: Correzione Calcolo Naked Put ITM nel Netting

## Obiettivo
Allineare il calcolo delle Naked Put ITM a quello delle Covered Call ITM, usando il valore intrinseco invece del costo di riacquisto a mercato.

## Problema Attuale
- **Covered Call ITM**: usa `(sottostante - strike) × contratti × 100 / cambio` ✓
- **Naked Put ITM**: usa `prezzo_mercato × quantità × 100 / cambio` ✗

## Soluzione

### File: `src/hooks/useDerivativeNetting.ts`

Modificare il blocco `else if (nakedPut)` (linee 118-133) per calcolare il valore intrinseco delle Naked Put ITM invece del costo di riacquisto:

**Logica corretta:**
- **Put OTM** (strike < sottostante): esclusa dal netting (scadrà senza valore)
- **Put ITM** (strike >= sottostante): sottrarre il valore intrinseco
  - Formula: `(strike - sottostante) × contratti × 100 / cambio`

### Modifica Specifica

```typescript
} else if (nakedPut) {
  const strikePrice = derivative.strike_price ?? 0;
  const underlyingPrice = nakedPut.underlying?.current_price ?? 0;
  
  // Netting ex CC: include sempre il costo di riacquisto a mercato
  nettingExCoveredCall += nettingValue;
  
  // Netting ex CC e NP OTM: gestione basata su ITM/OTM
  if (underlyingPrice > 0 && strikePrice < underlyingPrice) {
    // OTM: esclusa (scadrà senza valore)
  } else if (underlyingPrice > 0 && strikePrice >= underlyingPrice) {
    // ITM: sottrai valore intrinsico (coerente con covered call ITM)
    const contracts = Math.abs(quantity);
    const intrinsicValue = (contracts * multiplier * (strikePrice - underlyingPrice)) / exchangeRate;
    nettingExCCAndNP -= intrinsicValue;
  } else {
    // Prezzo sottostante non disponibile: fallback al costo di mercato
    nettingExCCAndNP += nettingValue;
  }
}
```

### Aggiornamento Documentazione
Aggiornare il commento JSDoc per riflettere la nuova logica:
- Netting ex CC e NP OTM:
  - OTM naked puts: escluse
  - ITM naked puts: sottrarre `(strike - sottostante) × contratti × 100 / cambio`

## Riepilogo Impatto
| Tipo | OTM | ITM |
|------|-----|-----|
| Covered Call | Esclusa | Sottrai intrinseco: `(sotto - strike)` |
| Naked Put | Esclusa | Sottrai intrinseco: `(strike - sotto)` |

## Dettagli Tecnici
- **File modificato**: `src/hooks/useDerivativeNetting.ts`
- **Linee interessate**: 118-138
- **Nessuna nuova dipendenza richiesta**
