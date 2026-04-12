
Obiettivo: rifare da zero il layer “Posizioni da monitorare”, non tutta la pagina Derivati.

Cosa ho trovato nel codice
- Il monitoraggio non nasce da un unico motore: è stato costruito a strati.
- Oggi esistono 4 livelli diversi che provano a descrivere le stesse posizioni:
  1. `DerivativesSummaryCard.tsx` calcola live la card dal frontend
  2. lo stesso componente salva un `monitoring_snapshot` già trasformato in stringhe
  3. `Derivatives.tsx` salva anche uno `strategy_cache`
  4. `daily-briefing` e `check-alerts` rileggono cache/snapshot con logiche proprie

In pratica il codice è stato creato così:
```text
positions + configs + prezzi
→ categorizeDerivatives()
→ card frontend "Posizioni da monitorare"
→ monitoring_snapshot (testo pronto)
→ strategy_cache (cache tecnica)
→ daily briefing / alerts ricostruiscono di nuovo
```

Perché oggi è pieno di bug
1. Non c’è una sola fonte di verità
- UI, snapshot, cache e alert engine possono divergere.

2. “Call da rivendere” usa euristiche, non legami esatti
- `DerivativesSummaryCard.tsx` somma `stockPositions` grezzi e CALL già classificate usando `resolveTickerFromPrices`, `getMatchingKey`, ticker e descrizioni.
- Non usa come fonte primaria gli slot reali collegati alle strategie (`linked_stock_slot_ids`) né un residuo stock canonico.
- Questo può mostrare capacità di covered call che in realtà non esiste.

3. Il caching è strutturalmente fragile
- `monitoring_snapshot` viene salvato una volta e poi bloccato da `snapshotSavedRef`, quindi può restare vecchio anche se i dati cambiano.
- `strategy_cache` viene rigenerato solo se cambiano i conteggi per categoria, non se cambiano ticker/strike/scadenze/composizione.

4. `strategy_cache` può collassare strategie diverse
- La chiave univoca è `(portfolio_id, strategy_key)`.
- `strategy_key` è costruita con pattern tipo underlying/strike/mese, senza `config_id`, `sort_order` o `position_ids`.
- Se hai più strategie simili sullo stesso sottostante, possono sovrascriversi o fondersi.

5. Il backend non replica fedelmente il frontend
- `daily-briefing/index.ts` ha una seconda implementazione del monitoraggio.
- `check-alerts/index.ts` usa ancora un altro percorso basato su `strategy_cache`.
- Quindi puoi vedere numeri diversi tra card, briefing e alert.

Conclusione
- Sì: per il monitoraggio conviene ricominciare da capo.
- No: non serve buttare via tutto il motore Derivati. Va rifatto da zero il layer che produce monitoraggio, conteggi e alert.

Piano di rifacimento
1. Audit mirato su silvias
- Confrontare per il portfolio reale:
  - posizioni stock
  - posizioni derivate
  - strategy_configurations
  - linked_stock_slot_ids
  - strategy_cache
  - monitoring_snapshot
- Obiettivo: ricostruire esattamente perché NVIDIA, UBER e BABA risultano sbagliati.

2. Creare un motore canonico unico per il monitoraggio
- Un’unica funzione deve produrre righe monitorabili tipizzate, non stringhe.
- Ogni riga deve avere:
  - `portfolio_id`
  - `config_id` o identificatore reale della strategia
  - `strategy_type`
  - `ticker`
  - `source_position_ids`
  - `linked_stock_slot_ids`
  - `contracts`
  - `shares_used`
  - `status`
- Le “Call da rivendere” devono essere calcolate dal residuo reale di azioni non già impegnate, non da matching testuali.

3. Riscrivere la card frontend sopra il nuovo motore
- `DerivativesSummaryCard.tsx` non deve più ricostruire conteggi con mappe manuali per ticker.
- Deve limitarsi a renderizzare il risultato canonico.

4. Smettere di usare `monitoring_snapshot` come fonte primaria
- Tenerlo al massimo come cache di presentazione.
- Non deve più essere la verità del sistema.

5. Riprogettare `strategy_cache` oppure sostituirlo
- Se resta, deve poter rappresentare strategie duplicate senza collisioni.
- Servono identificatori stabili basati su config/posizioni, non solo su underlying+strike+mese.
- Va riallineato anche il sistema dei toggle/alert che oggi usa `strategy_key`.

6. Unificare briefing e alert
- `daily-briefing` e `check-alerts` devono leggere la stessa struttura canonica del frontend.
- Basta duplicazioni di logica.

7. Rigenerare i dati esistenti
- Pulizia di snapshot/cache vecchi.
- Rebuild completo per i portfolio interessati, incluso silvias.

Dettagli tecnici
- File sicuramente coinvolti:
  - `src/components/derivatives/DerivativesSummaryCard.tsx`
  - `src/pages/Derivatives.tsx`
  - `src/lib/strategyCache.ts`
  - `src/lib/refreshStrategyCache.ts`
  - `supabase/functions/daily-briefing/index.ts`
  - `supabase/functions/check-alerts/index.ts`
  - probabilmente `src/components/derivatives/AlertSettingsDialog.tsx`
- Problemi strutturali già verificati nel codice:
  - snapshot salvato in modo one-shot
  - cache invalidata solo sui conteggi
  - chiavi cache non abbastanza uniche
  - logica duplicata in frontend e backend
- Possibile lavoro backend:
  - migrazione per correggere o sostituire la struttura di cache
  - stesse policy di accesso per portfolio owner/admin

Risultato atteso dopo il refactor
```text
1 sola logica
→ stessi numeri in card / briefing / alert
→ nessuna “call da rivendere” fantasma
→ conteggi corretti per NVIDIA / UBER / BABA
→ debugging finalmente tracciabile per strategia e per posizione
```
