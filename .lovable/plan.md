

## Rinomina portafoglio dalla sezione Admin

### Cosa cambia

Aggiungere un pulsante "Rinomina" (icona matita) accanto a ogni portafoglio nella sezione admin, sia per i portafogli utenti che per quelli propri. Cliccando si apre un dialog con un campo di testo precompilato col nome attuale; confermando si aggiorna il nome nel database.

### Modifiche

**File: `src/components/admin/PortfolioManager.tsx`**

1. **Nuovo stato** per il dialog di rinomina:
   - `portfolioToRename: PortfolioWithOwner | null`
   - `newPortfolioName: string`
   - `isRenaming: boolean`

2. **Funzione `handleRename`**: esegue `supabase.from('portfolios').update({ name }).eq('id', portfolioId)`, poi chiama `refetch()` e chiude il dialog. L'admin ha gia' la RLS policy `ALL` sulla tabella `portfolios`, quindi nessuna modifica al database e' necessaria.

3. **Pulsante Rinomina** (icona `Pencil` da lucide-react):
   - Nella sezione "Portafogli Utenti": aggiunto tra il pulsante "Copia" e "Apri" in ogni riga della tabella (righe 148-176)
   - Nella sezione "I Miei Portafogli": aggiunto tra "Copia su Utente" e il cestino (righe 224-240)

4. **Dialog di rinomina**: un nuovo `Dialog` con un `Input` precompilato col nome attuale, pulsante "Annulla" e "Salva". Validazione: nome non vuoto e diverso dall'originale.

5. **Import aggiuntivi**: `Pencil` da lucide-react, `Input` da `@/components/ui/input`

### Nessuna modifica al database

La RLS policy `Admins can manage all portfolios` (comando `ALL`) consente gia' all'admin di fare UPDATE su qualsiasi portafoglio. Non servono migrazioni.

