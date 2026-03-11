

## Fix: Deduplicazione ordini Excel e nuovo tasto "Cancella Operazioni"

### Problema 1: Duplicati al caricamento
`mergeOrders` usa un set di chiavi per evitare duplicati esatti, ma non filtra le operazioni precedenti all'ultima già caricata. Se l'utente carica un file che contiene sia operazioni vecchie che nuove, vengono aggiunte tutte quelle non duplicate per chiave, ma non c'è un filtro temporale.

**Soluzione**: dopo il merge, filtrare le nuove operazioni in modo che vengano aggiunte solo quelle con data successiva all'ultima operazione già presente (`lastOperationDate`). Questo va fatto dentro `onDrop`, confrontando la `validityDate` (convertita in ISO) delle nuove operazioni con l'ultima data già presente negli ordini correnti.

### Problema 2: "Cancella Operazioni" vs "Reset"
Attualmente esiste solo "Reset" che cancella tutto dal database. L'utente vuole un tasto "Cancella Operazioni" che pulisca solo la card (stato locale: `callOrders`, `putOrders`, `metrics`) senza toccare il database, così lo storico resta recuperabile.

**Soluzione**: aggiungere un nuovo handler `handleClearOrders` che resetta solo lo stato locale (ordini, metriche, parseResult) senza chiamare `deletePremium`. Aggiungere un bottone `Trash2` accanto a "Reset".

### File da modificare

**`src/lib/orderFileParser.ts`** — Aggiornare `mergeOrders` per accettare un parametro opzionale `afterDate?: string` che filtra i nuovi ordini con data > afterDate prima di fare il merge.

**`src/components/derivatives/CallPremiumCalculatorDialog.tsx`**:
- Nel `onDrop`, calcolare la data dell'ultima operazione corrente e passarla a `mergeOrders` per filtrare solo operazioni successive
- Aggiungere `handleClearOrders` che resetta solo lo stato locale (callOrders, putOrders, metrics, parseResult) senza toccare il DB
- Aggiungere bottone "Cancella Operazioni" (icona Trash2) accanto al bottone "Reset" nella barra azioni

