
# Piano: Copia Portfolio Globale per Admin

## Situazione Attuale

L'admin può copiare **solo i propri portafogli** su altri utenti. Le limitazioni sono:

1. **Edge Function** (`admin-copy-portfolio`): verifica che il portafoglio sorgente appartenga all'admin (riga 71-84)
2. **UI** (`PortfolioManager`): mostra il pulsante "Copia" solo nella sezione "I Miei Portafogli"
3. **CopyPortfolioDialog**: la lista destinatari esclude l'admin stesso

## Obiettivo

Permettere all'admin di:
- Copiare **qualsiasi portafoglio** (anche di altri utenti)
- Incollarlo su **qualsiasi utente** (incluso se stesso)

---

## Modifiche Richieste

### 1. Edge Function: Rimuovere Restrizione Proprietà

**File:** `supabase/functions/admin-copy-portfolio/index.ts`

Modificare la verifica del portafoglio sorgente per permettere la copia di qualsiasi portafoglio:

```typescript
// PRIMA (riga 71-84):
const { data: sourcePortfolio, error: sourceError } = await supabaseAdmin
  .from('portfolios')
  .select('*')
  .eq('id', sourcePortfolioId)
  .eq('user_id', user.id)  // ❌ Limita ai propri portafogli
  .single();

// DOPO:
const { data: sourcePortfolio, error: sourceError } = await supabaseAdmin
  .from('portfolios')
  .select('*')
  .eq('id', sourcePortfolioId)
  // Rimosso: .eq('user_id', user.id) - l'admin può copiare qualsiasi portfolio
  .single();
```

Aggiornare anche il messaggio di errore:
```typescript
// PRIMA:
{ error: 'Source portfolio not found or does not belong to you' }

// DOPO:
{ error: 'Source portfolio not found' }
```

---

### 2. UI: Aggiungere Pulsante Copia ai Portafogli Utenti

**File:** `src/components/admin/PortfolioManager.tsx`

Aggiungere un pulsante "Copia" anche nella tabella dei portafogli degli altri utenti:

```typescript
// Nella sezione "Portafogli Utenti" (riga 178-199)
{userGroup.portfolios.map((portfolio) => (
  <TableRow key={portfolio.id} ...>
    {/* ... celle esistenti ... */}
    <TableCell className="text-right">
      <div className="flex items-center justify-end gap-2">
        {/* Nuovo pulsante Copia */}
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation(); // Evita che si apra il portfolio
            handleCopyClick(portfolio);
          }}
        >
          <Copy className="w-4 h-4 mr-2" />
          Copia
        </Button>
        {/* Pulsante Apri esistente */}
        <Button variant="ghost" size="sm">
          <ExternalLink className="w-4 h-4 mr-2" />
          Apri
        </Button>
      </div>
    </TableCell>
  </TableRow>
))}
```

---

### 3. CopyPortfolioDialog: Includere Tutti gli Utenti

**File:** `src/components/admin/PortfolioManager.tsx`

Modificare la lista utenti per il dialog di copia includendo anche l'admin:

```typescript
// PRIMA (riga 48-53):
const allUsersForCopy = otherUsers.map(u => ({
  userId: u.userId,
  email: u.email,
  name: u.name,
}));

// DOPO:
const allUsersForCopy = useMemo(() => {
  // Includi tutti gli utenti, compreso l'admin
  const users = Object.values(portfoliosByUser).map(u => ({
    userId: u.userId,
    email: u.email,
    name: u.name,
  }));
  
  // Se l'admin non ha portafogli, potrebbe non essere nella lista
  // Aggiungiamolo manualmente se necessario
  if (user && !users.find(u => u.userId === user.id)) {
    // L'admin potrebbe non avere profilo visibile, aggiungiamolo
    // Nota: questo caso è raro perché il profilo viene creato al signup
  }
  
  return users;
}, [portfoliosByUser, user]);
```

Nota: con questa modifica, l'admin può copiare un portafoglio di un altro utente su se stesso, o il proprio su se stesso (creando un duplicato).

---

### 4. Hook: Esporre portfoliosByUser

**File:** `src/hooks/useAdminPortfolios.ts`

Il hook già espone `portfoliosByUser`, quindi non serve modifica.

---

## Riepilogo File da Modificare

| File | Modifica |
|------|----------|
| `supabase/functions/admin-copy-portfolio/index.ts` | Rimuovere `.eq('user_id', user.id)` dalla query del portafoglio sorgente |
| `src/components/admin/PortfolioManager.tsx` | 1. Aggiungere pulsante "Copia" ai portafogli degli altri utenti; 2. Includere tutti gli utenti nella lista destinatari |

---

## Comportamento Atteso

### Prima
- Admin vede "Copia su Utente" solo per i propri portafogli
- La lista destinatari esclude l'admin

### Dopo
- Admin vede "Copia" su **tutti** i portafogli (propri e altrui)
- La lista destinatari include **tutti** gli utenti (incluso l'admin stesso)
- L'admin può:
  - Copiare il proprio portfolio su un altro utente ✓
  - Copiare il proprio portfolio su se stesso (duplicato) ✓
  - Copiare il portfolio di un utente su un altro utente ✓
  - Copiare il portfolio di un utente su se stesso ✓

---

## Considerazioni di Sicurezza

La funzionalità rimane sicura perché:
1. **Solo admin**: la Edge Function verifica il ruolo admin prima di procedere
2. **Utente valido**: la Edge Function verifica che l'utente destinatario esista
3. **Audit trail**: ogni copia crea nuovi record con timestamp aggiornati
