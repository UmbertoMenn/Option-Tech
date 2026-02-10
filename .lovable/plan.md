

## Informativa bloccante post-login

### Come funziona
Dopo il login, prima di poter accedere all'app, l'utente vede un dialog modale a schermo intero con il testo dell'informativa. Solo cliccando "Confermo ed accetto quanto sopra" potra proseguire. L'accettazione viene salvata in `sessionStorage` cosi da non ripresentarsi durante la stessa sessione (ma riappare ad ogni nuovo accesso).

### Modifiche

**1. Nuovo componente: `src/components/auth/DisclaimerDialog.tsx`**
- Dialog modale bloccante (non chiudibile con ESC o click esterno)
- Testo dell'informativa formattato con paragrafi separati
- Pulsante "Confermo ed accetto quanto sopra" ben visibile (grande, colore primario)
- Al click: salva accettazione in `sessionStorage` e chiama callback `onAccept`

**2. Modifica: `src/App.tsx`**
- In `AppRoutes`, dopo il check `user` autenticato, aggiungere uno stato `disclaimerAccepted` (inizializzato da `sessionStorage`)
- Se l'utente e autenticato ma non ha accettato, mostrare `DisclaimerDialog` invece delle route
- Al click su "Confermo ed accetto quanto sopra", settare lo stato e salvare in `sessionStorage`

### Dettagli tecnici

Il componente `DisclaimerDialog` utilizzera il componente `AlertDialog` di Radix (gia presente nel progetto) configurato per non essere chiudibile dall'utente se non tramite il pulsante di conferma. L'accettazione viene memorizzata solo per la sessione corrente del browser (`sessionStorage`), quindi ad ogni nuovo login l'informativa riappare.

