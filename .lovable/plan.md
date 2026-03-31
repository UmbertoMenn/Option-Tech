
Obiettivo: fermare il crash della pagina Derivati e rendere “Riconfigura strategie” sicuro anche con portafogli grandi, senza toccare la logica di classificazione già salvata.

Diagnosi reale dal codice:
- `addToStrategy` nel Wizard oggi è sintatticamente completo: non è lì il bug principale.
- Il crash più evidente nel codice è in `src/components/derivatives/StrategyReconciliationDialog.tsx`: il dialog inizializza stato durante il render con `if (open && !initialized) { initStates(); }`, e questo può mandare in errore l’intera route.
- In `src/pages/Derivatives.tsx` i dialog sono montati sempre, senza `ErrorBoundary`: se uno dei due fallisce, salta tutta la pagina.
- `src/components/derivatives/StrategyConfigWizard.tsx` fa comunque lavoro pesante di grouping/restoration; su portafogli grandi questo può sembrare un crash anche quando non salva nulla.

Piano di fix

1. Mettere in sicurezza la pagina Derivati
- In `src/pages/Derivatives.tsx`, montare `StrategyConfigWizard` e `StrategyReconciliationDialog` solo quando sono aperti.
- Wrappare entrambi in `ErrorBoundary` dedicati, così un errore in un dialog non butta giù tutta la pagina Strategie Derivati.

2. Correggere il crash reale del dialog “Configurazioni da aggiornare”
- In `src/components/derivatives/StrategyReconciliationDialog.tsx`, rimuovere completamente l’inizializzazione che oggi avviene durante il render.
- Spostare tutta l’inizializzazione in un `useEffect` o nel solo flusso di apertura del dialog, in modo React-safe.
- Lasciare invariato il bottone `+N` già presente lì.

3. Alleggerire davvero “Riconfigura strategie”
- In `src/components/derivatives/StrategyConfigWizard.tsx`, evitare lavoro pesante quando `open === false`:
  - short-circuit su `allAvailable` / `underlyingGroups` quando il dialog è chiuso
  - restore delle configurazioni solo all’apertura
- Tenere `startTransition`, ma fare in modo che il Wizard non prepari tutto in anticipo quando non serve.

4. Blindare il Wizard senza cambiare comportamento utente
- Lasciare il `+N` nel Wizard, ma consolidare `addToStrategy` nella forma più semplice e sicura:
  - prende solo posizioni selezionate e non assegnate
  - le aggiunge alla strategia
  - ricalcola `suggestedType`
  - pulisce la selezione del gruppo
- Verificare che l’apertura del Wizard non faccia nessun salvataggio né variazione automatica: deve solo leggere configurazioni esistenti e mostrarle.

5. Verifica funzionale finale
- Caso 1: upload Excel con discrepanze → il dialog “Configurazioni da aggiornare” si apre senza schermata bianca.
- Caso 2: click su “Riconfigura strategie” → la pagina non crasha e resta responsiva.
- Caso 3: apertura/chiusura del Wizard senza salvare → nessuna modifica visibile nelle strategie derivate.
- Caso 4: `+N` presente e funzionante sia nel Wizard sia nel dialog di riconciliazione.

File da toccare
- `src/pages/Derivatives.tsx`
- `src/components/derivatives/StrategyReconciliationDialog.tsx`
- `src/components/derivatives/StrategyConfigWizard.tsx`
