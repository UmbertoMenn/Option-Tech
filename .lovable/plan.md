
## Fix: Portfolio copiato non visibile dopo la copia

### Problema
Dopo aver copiato un portafoglio sull'account admin, i dati vengono salvati correttamente nel database (confermato: 157 posizioni, 5 depositi, 6 record storici). Tuttavia l'app continua a mostrare il portafoglio precedentemente selezionato perche:

1. La query del **PortfolioContext** (`['portfolios', user.id]`) non viene invalidata dopo la copia, quindi il nuovo portafoglio non appare nel selettore.
2. L'app non seleziona automaticamente il portafoglio appena copiato.

### Soluzione

**File: `src/components/admin/CopyPortfolioDialog.tsx`**

Dopo il successo della copia, oltre a chiamare `onSuccess()`:
- Invalidare la query `['portfolios']` nel queryClient per aggiornare il selettore
- Selezionare automaticamente il nuovo portafoglio usando `selectPortfolio(newPortfolioId)`

Modifiche:
- Importare `useQueryClient` da `@tanstack/react-query`
- Importare `usePortfolioContext` per accedere a `selectPortfolio`
- Nella funzione `handleCopy`, dopo il successo:
  1. Invalidare `['portfolios']` per aggiornare la lista nel selettore
  2. Chiamare `selectPortfolio(data.newPortfolioId)` se il target e l'utente admin corrente (cosi il portafoglio copiato viene mostrato subito)

```typescript
// Nel componente CopyPortfolioDialog:
const queryClient = useQueryClient();
const { selectPortfolio } = usePortfolioContext();
const { user } = useAuth();

// In handleCopy, dopo il successo:
queryClient.invalidateQueries({ queryKey: ['portfolios'] });

// Se il target sono io (admin), seleziona il nuovo portafoglio
if (targetUserId === user?.id && data?.newPortfolioId) {
  selectPortfolio(data.newPortfolioId);
}
```

### Dettaglio tecnico

| Azione | Cosa risolve |
|--------|-------------|
| `invalidateQueries(['portfolios'])` | Il nuovo portafoglio appare nel selettore dropdown |
| `selectPortfolio(newPortfolioId)` | Il portafoglio copiato viene visualizzato immediatamente |
| Condizione `targetUserId === user?.id` | Auto-selezione solo se la copia e per l'admin stesso |
