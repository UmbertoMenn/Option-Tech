

## Fix: Creazione utente da admin causa logout

### Problema

Nella sezione admin, la creazione di un nuovo utente usa `supabase.auth.signUp()` lato client. Questo metodo crea l'utente E lo logga automaticamente, causando il logout dell'admin e il login come nuovo utente.

### Soluzione

Creare una nuova edge function `admin-create-user` che usa l'Admin API di Supabase (`auth.admin.createUser`), che crea l'utente senza modificare la sessione corrente.

### Modifiche

**1. Nuova edge function: `supabase/functions/admin-create-user/index.ts`**

- Verifica che il chiamante sia admin (stesso pattern di `admin-delete-user`)
- Usa `supabaseAdmin.auth.admin.createUser()` con `email_confirm: true` (utente gia' verificato)
- Accetta `email`, `password`, `full_name` nel body
- Il trigger `handle_new_user` gia' esistente crea automaticamente il profilo, il ruolo e il portafoglio

**2. Modifica: `src/components/admin/AdminPanel.tsx`**

- Sostituire la chiamata `supabase.auth.signUp()` con `supabase.functions.invoke('admin-create-user', { body: { email, password, full_name } })`
- La sessione admin resta intatta

### Dettaglio edge function

```text
POST admin-create-user
Headers: Authorization: Bearer <admin_token>
Body: { email, password, full_name }

Flow:
1. Verifica token -> ottieni user_id
2. Verifica ruolo admin (has_role)
3. supabaseAdmin.auth.admin.createUser({
     email, password,
     email_confirm: true,
     user_metadata: { full_name }
   })
4. Ritorna { user: createdUser }
```

### File coinvolti

| File | Modifica |
|------|----------|
| `supabase/functions/admin-create-user/index.ts` | Nuova edge function |
| `src/components/admin/AdminPanel.tsx` | Sostituire `signUp` con invocazione edge function |

