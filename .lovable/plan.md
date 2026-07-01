## Problema

1. **Salvataggio non persistente**: creando una strategia (spec. da posizioni sotto filtro "Libere") e cliccando *Salva Configurazione*, la strategia sembra non essere memorizzata alla riapertura del wizard.
2. **Filtro "Libere" espelle la strategia appena creata**: appena si crea una strategia da un gruppo, quel gruppo perde le sue "posizioni libere" e sparisce dalla vista *Libere*. Risultato: la nuova strategia non è più visibile e non si può cambiarne il tipo dalla tendina, obbligando l'utente a passare a *Tutte* e cercarla.

## Soluzione

### A. Filtro "Libere" — mantenere visibili i gruppi appena toccati

- Introdurre in `StrategyConfigWizard` uno stato locale `touchedGroupKeys: Set<string>` (persistito nel `WizardDraft` insieme agli altri campi).
- Aggiungere il group key al set quando l'utente compie una qualsiasi delle azioni:
  - `createStrategyFromSelected` (nuova strategia creata dal gruppo)
  - `addToStrategy` (aggiunta di leg a una strategia del gruppo)
  - `removeFromStrategy`, `deleteStrategy`, `updateStrategyType`, `toggleSynthetic` (modifica strategia appartenente al gruppo)
- Modificare il branch `groupFilter === 'unassigned'` in `filteredGroups`:

  ```ts
  groups = groups.filter(g =>
    g.positions.some(p => !assignedIds.has(p.id)) || touchedGroupKeys.has(g.key)
  );
  ```

- Reset di `touchedGroupKeys` alla chiusura del wizard (viene già rimosso il draft in `handleOpenChange` e `handleSave`).

Effetto: dopo la creazione della strategia il gruppo resta visibile in *Libere* per l'intera sessione, permettendo di scegliere il tipo dalla tendina senza cambiare filtro.

### B. Salvataggio strategie — diagnosi e fix

Analisi del flusso attuale (`handleSave` → `useStrategyConfigurations.upsertBatch`):

1. `handleSave` costruisce `rawConfigs` da `strategies`.
2. `upsertBatchMutation` esegue `delete` di TUTTI i config del portfolio, poi `insert` dei nuovi.
3. Se il click "Salva" viene fatto mentre il wizard è in un filtro parziale con `filterUnderlyings` **non** settato (il caso del filtro UI Tutte/Libere/Archiviate: non setta la prop), **tutti gli esistenti passano dallo state `strategies`** — devono essere lì grazie a `restoreFromConfigs` all'apertura.

Cause probabili del bug segnalato dopo l'ultima modifica:

- L'utente crea la strategia sotto *Libere*, il gruppo sparisce (bug A). Se poi rimuove un leg pensando di correggere o clicca il cestino dentro un altro gruppo non visibile (perché contratto ma con lo stesso underlying archiviato/collassato), la strategia risulta cancellata silenziosamente.
- Strategie composte da **sole azioni** (nessuna gamba derivata): `buildSignatures` restituisce `[]`. La riga viene inserita, ma dopo `recomputeLatestSnapshot` altri percorsi (monitoraggio) la scartano perché priva di derivati — l'utente pensa quindi che non sia stata salvata.

Interventi:

1. Correggere il bug A (sopra) elimina il caso più frequente di "strategia scomparsa".
2. In `handleSave` mostrare in caso di errore un `toast.error` esplicito con il messaggio Supabase (attualmente già presente in `onError`, verificare che non sia mascherato) e aggiungere log `console.error` prima del throw per facilitare la diagnosi.
3. In `handleSave` **rifiutare** e mostrare toast di errore se una strategia ha 0 derivati (previene ambiguità: le strategie senza leg opzione non sono rappresentabili nel monitoraggio). Il messaggio guida l'utente a includere almeno un contratto o eliminare la voce.
4. Riprodurre in sandbox (Playwright) l'esatto scenario segnalato (portfolio → apri wizard → filtra *Libere* → crea strategia da un gruppo → Salva → riapri wizard) per verificare la persistenza dopo il fix A.

## File toccati

- `src/components/derivatives/StrategyConfigWizard.tsx`
  - Nuovo stato `touchedGroupKeys` + persistenza draft
  - Marcatura del gruppo negli handler di creazione/modifica strategia
  - `filteredGroups` per *Libere* rilassato con OR su touched
  - `handleSave`: guard "almeno un derivato per strategia" + log/toast diagnostici

Nessuna modifica a hook, edge functions o schema DB.

## Verifica

- Playwright su `/derivatives`: apri wizard, filtra *Libere*, seleziona posizioni di un gruppo, crea strategia → il gruppo resta visibile; imposta il tipo dalla tendina → salva → riapri: la configurazione è presente.
- Test manuale con strategia legata a stock split (slot 100 azioni) per assicurare che il flusso di persistenza pre-esistente non regressi.
