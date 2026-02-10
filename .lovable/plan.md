

## Fix: Disclaimer non riappare dopo logout e nuovo login

### Problema
Il disclaimer non riappare perche `sessionStorage.getItem('disclaimerAccepted')` resta `'true'` anche dopo il logout. Il `sessionStorage` viene pulito solo quando si chiude la tab del browser, non al logout.

### Soluzione
Aggiungere `sessionStorage.removeItem('disclaimerAccepted')` nella funzione `signOut` del contesto di autenticazione (`src/contexts/AuthContext.tsx`), in modo che ad ogni logout il flag venga rimosso.

### Modifica

**`src/contexts/AuthContext.tsx`** - funzione `signOut`:
```typescript
const signOut = async () => {
  sessionStorage.removeItem('disclaimerAccepted'); // <-- aggiunta
  await supabase.auth.signOut();
  setIsAdmin(false);
};
```

Questo garantisce che ogni volta che l'utente esce e rientra, il disclaimer venga nuovamente mostrato.

