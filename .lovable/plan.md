
Obiettivo

- Il wizard strategie derivati deve aprirsi solo su azione esplicita dell’utente.
- Entrare nella pagina, ricaricarla o cambiare portafoglio non deve più aprire automaticamente il dialog.

Causa verificata nel codice

- In `src/pages/Derivatives.tsx` c’è un `useEffect` che fa `setWizardOpen(true)` quando `needsWizard` oppure `?wizard=1` sono veri.
- `needsWizard` diventa vero quando mancano configurazioni o ci sono derivati non coperti, quindi oggi il wizard si riapre a ogni accesso.
- In `src/components/dashboard/FileUploader.tsx` dopo un upload con derivati viene fatto `navigate('/derivatives?wizard=1')`, che alimenta lo stesso comportamento.
- `src/components/derivatives/StrategyConfigWizard.tsx` non è la causa: si apre solo perché riceve `open=true`.

Piano di correzione

1. Disaccoppiare controllo dati e apertura UI
- Rimuovere da `Derivatives.tsx` la logica che apre il wizard dentro `useEffect`.
- Lasciare `wizardOpen` controllato solo dai bottoni “Configura strategie” / “Riconfigura strategie”.

2. Eliminare il trigger da URL
- Smontare il flusso basato su `?wizard=1`.
- Aggiornare `FileUploader.tsx` per non navigare più con quel query param.
- Gestire eventuali URL legacy con `?wizard=1` rimuovendolo senza aprire il wizard.

3. Sostituire il popup con un avviso non bloccante
- Riutilizzare `needsWizard` come stato informativo, non come trigger.
- Mostrare nella pagina un banner/card inline quando esistono posizioni da configurare, con CTA per aprire manualmente il wizard.
- Lasciare invariato l’empty state quando non esiste ancora nessuna configurazione.

4. Rendere la logica più chiara per evitare regressioni
- Rinominare concettualmente `needsWizard` in qualcosa tipo `hasPendingStrategyConfig`, così non viene più usato per mutare `open`.
- Tenere separati:
  - stato diagnostico
  - azione utente
  - stato del dialog

5. Verifiche da coprire in implementazione
- Accesso diretto a `/derivatives`: nessuna apertura automatica.
- Refresh pagina: nessuna apertura automatica.
- Cambio portafoglio: nessuna apertura automatica.
- Upload con derivati: eventuale redirect alla pagina sì, wizard no.
- Click manuale sul bottone: wizard si apre normalmente.

File da toccare

- `src/pages/Derivatives.tsx`
- `src/components/dashboard/FileUploader.tsx`

Dettaglio tecnico

```text
Oggi:
load dati/config -> needsWizard = true -> useEffect -> setWizardOpen(true)

Dopo la fix:
load dati/config -> hasPendingStrategyConfig = true -> banner/CTA
click utente -> setWizardOpen(true)
```

Risultato atteso

- Il wizard non si aprirà più da solo ogni volta che accedi alla pagina Strategie Derivati.
- Se mancano configurazioni, vedrai un avviso chiaro ma non invasivo.
- L’apertura resterà sempre e solo manuale.
