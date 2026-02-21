

## Fix: Regola di approccio non scatta quando il prezzo supera lo strike

### Causa del bug

La condizione di attivazione della regola di approccio barriera (riga 248) richiede:
```text
dist <= activationPct (es. 2%)  AND  S >= strike * (1 - 2/100)
```

Questo crea una **finestra strettissima**: il prezzo deve trovarsi entro il 2% dallo strike (es. tra 132.30 e 137.70 per strike 135). Una volta che il prezzo supera questa banda (es. sale a 150, 200), la distanza diventa 11%, 48% ecc. e la regola non scatta piu.

Il risultato: dopo il roll up a strike 135 del 13/05/2025, il prezzo e salito rapidamente oltre 135 e non e piu rientrato nella banda del 2%. Nessun aggiustamento fino alla scadenza naturale nel maggio 2026.

### Soluzione

La condizione deve scattare quando il prezzo **raggiunge o supera** la zona di attivazione, non solo quando si trova al suo interno.

**Riga 248 di `src/lib/backtestEngine.ts`** -- sostituire:

```text
// PRIMA (bug):
const dist = Math.abs(S - leg.strike) / leg.strike * 100;
if (dist <= ccRules.approachRule.activationPct && S >= leg.strike * (1 - ccRules.approachRule.activationPct / 100))

// DOPO (fix):
if (S >= leg.strike * (1 - ccRules.approachRule.activationPct / 100))
```

Rimuovere il controllo `dist <= activationPct`. La condizione rimasta (`S >= strike * 0.98`) e sufficiente: scatta quando il prezzo e entro il 2% sotto lo strike OPPURE ovunque sopra lo strike. In questo modo:

- Prezzo a 133 (strike 135): `133 >= 135*0.98 = 132.3` -- scatta
- Prezzo a 200 (strike 135): `200 >= 132.3` -- scatta
- Prezzo a 120 (strike 135): `120 >= 132.3` -- NON scatta (troppo lontano)

### Dettaglio tecnico

| File | Modifica |
|------|----------|
| `src/lib/backtestEngine.ts` | Righe 247-248: rimuovere la variabile `dist` e la condizione `dist <= activationPct`, mantenere solo `S >= leg.strike * (1 - activationPct / 100)` |

