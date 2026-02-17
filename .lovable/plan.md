
## Fix Calcolo Call Non Coperte nella Vista Aggregata

### Problema Identificato

La card "Posizioni da monitorare" nella pagina Strategie Derivati usa una funzione `normalizeForMatching` locale e semplificata (in `DerivativesSummaryCard.tsx`, riga 26) diversa da quella completa usata nel motore di classificazione (`derivativeStrategies.ts`, riga 1078).

Quando si aggregano posizioni di piu utenti, lo stesso titolo ha descrizioni diverse tra broker:
- `"ALIBABA GROUP HOLDING LTD SPON ADS EACH REP 8 ORD SHS"` (utente A)
- `"AZ.ALIBABA GROUP HOLDING LTD"` (utente B)

Il normalizzatore semplice produce chiavi diverse per lo stesso titolo, causando:
- Azioni conteggiate in bucket separati
- Call vendute assegnate a un terzo bucket
- Risultato: false "call non coperte" (7 invece di 1)
- Adobe non appare come non coperta perche le sue chiavi cadono in un bucket con azioni sufficienti

### Soluzione

Sostituire la funzione `normalizeForMatching` locale in `DerivativesSummaryCard.tsx` con l'import della funzione completa da `derivativeStrategies.ts`, gia esportata e usata dal motore di classificazione. Questo garantisce che le chiavi di aggregazione siano identiche tra classificazione e riepilogo.

### File modificati

| File | Modifica |
|------|----------|
| `src/components/derivatives/DerivativesSummaryCard.tsx` | Rimuovere la funzione `normalizeForMatching` locale (righe 26-32) e importarla da `@/lib/derivativeStrategies` |

### Dettaglio Tecnico

La funzione completa in `derivativeStrategies.ts` gestisce:
- Rimozione prefisso `AZ.`
- Punti tra parole lunghe trattati come spazi (`AMAZON.COM` -> `AMAZON COM`)
- Abbreviazioni con punto collassate (`J.P.` -> `JP`)
- Parentesi rimosse (`(OHIO)`)
- Suffissi corporativi rimossi ovunque nel testo, non solo in coda (`INC`, `CORP`, `LTD`, `PLC`, `ADR`, `SPA`, ecc.)
- Normalizzazione spazi multipli

Dopo la modifica, tutte le varianti di "ALIBABA" produrranno la stessa chiave normalizzata, e il conteggio azioni/call sara corretto. Il risultato atteso sara 1 sola call non coperta (Adobe dell'utente senza azioni ADBE).
