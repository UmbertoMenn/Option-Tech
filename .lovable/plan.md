

## Fix: esclusione conto liquidita non funziona in modalita admin

### Problema

Nella riga 42 di `FileUploader.tsx`, il lookup usa `user?.id` che e l'ID dell'admin loggato, non quello dell'utente impersonificato (MauroG). Quindi la mappa `EXCLUDED_CASH_ACCOUNTS` non trova corrispondenza e il conto `0652278918440` viene incluso nella liquidita.

### Soluzione

**File: `src/components/dashboard/FileUploader.tsx`**

1. Importare `usePortfolioContext` e ottenere `isAdminMode` e `adminViewUserId`
2. Calcolare l'ID utente effettivo (come fanno gia `useAlerts`, `usePriceAlerts`, ecc.):
   ```typescript
   const effectiveUserId = isAdminMode && adminViewUserId ? adminViewUserId : user?.id;
   ```
3. Usare `effectiveUserId` al posto di `user?.id` nella riga 42:
   ```typescript
   const excludedCashAccounts = EXCLUDED_CASH_ACCOUNTS[effectiveUserId || ''] || [];
   ```

### Dettaglio modifiche

- Aggiungere import: `import { usePortfolioContext } from '@/contexts/PortfolioContext';`
- Aggiungere nel componente: `const { isAdminMode, adminViewUserId } = usePortfolioContext();`
- Calcolare: `const effectiveUserId = isAdminMode && adminViewUserId ? adminViewUserId : user?.id;`
- Sostituire `user?.id` con `effectiveUserId` nella riga 42

### Cosa NON cambia
- Nessuna modifica al parser Excel
- Nessuna modifica alla logica di upload
- Nessun impatto su utenti non-admin (per loro `effectiveUserId === user?.id`)

