

## Piano: Rimuovere email personali, login con username, recupero password via admin

### Panoramica
Trasformare il sistema di autenticazione da email+password a username+password. Rimuovere tutte le email personali degli utenti dalla piattaforma. Le uniche email nel sistema saranno quelle degli admin, usate per ricevere le richieste di recupero password.

### Vincolo tecnico
Il backend auth richiede internamente un indirizzo email. Il sistema mapperà automaticamente `username` → `username@internal.local` in modo trasparente.

---

### 1. Migrazione database

**Aggiungere colonna `username` alla tabella `profiles`**, rimuovere obbligo su `email`:
```sql
ALTER TABLE profiles ADD COLUMN username text;
ALTER TABLE profiles ADD COLUMN admin_contact_email text; -- solo per admin
ALTER TABLE profiles ALTER COLUMN email DROP NOT NULL;
```

Aggiornare il trigger `handle_new_user` per salvare lo username dal metadata:
```sql
-- Nel trigger: estrarre username da user_metadata
INSERT INTO profiles (user_id, email, full_name, username)
VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'username');
```

### 2. Login (`AuthForm.tsx`)

- Sostituire campo "Email" con "Nome utente" (icona `User` al posto di `Mail`)
- Internamente nel `signIn`: costruire email fittizia `${username}@internal.local`
- Placeholder: `"mario_rossi"`

### 3. AuthContext (`AuthContext.tsx`)

- `signIn(username, password)` → chiama `signInWithPassword({ email: username + '@internal.local', password })`
- Aggiornare interfaccia `AuthContextType`

### 4. Creazione utente admin (`AdminPanel.tsx` + edge function `admin-create-user`)

- Sostituire campo "Email" con "Nome utente" nel form di creazione
- Edge function: ricevere `username` + `password`, creare utente con email `username@internal.local`
- Passare `username` nel `user_metadata`

### 5. Pannello admin - tabella utenti

- Rimuovere colonna "Email" dalla tabella
- Mostrare "Username" al suo posto (dal campo `username` del profilo, o derivato dall'email rimuovendo `@internal.local`)

### 6. Email admin per notifiche (`AdminNotificationSettings.tsx`)

- Aggiungere campo "Email di contatto admin" nella sezione Notifiche Admin
- Salvato nella colonna `admin_contact_email` del profilo admin
- Questo è l'indirizzo dove arrivano le richieste di recupero password

### 7. Recupero password (`AuthForm.tsx` + edge function `generate-reset-link`)

**Frontend**: 
- L'utente inserisce il proprio username
- Dopo l'invio, mostra messaggio: "La richiesta è stata inviata all'amministratore. Verrai contattato per il reset della password."

**Edge function `generate-reset-link`** (riscritta):
- Riceve `username`
- Cerca tutti i profili admin con `admin_contact_email` configurata
- Invia email a ciascun admin con il messaggio: "L'utente {username} ha richiesto il reset della password"
- Non genera più link di recovery automatici

**Admin**: resetterà la password manualmente dal pannello (nuova funzionalità: pulsante "Reset Password" nella riga utente → genera nuova password temporanea)

### 8. Notifiche utente (`NotificationSettings.tsx`)

- Rimuovere sezione "Notifiche Email" (toggle + icona)
- Mantenere solo "Notifiche Telegram"

### 9. Notifiche admin (`AdminNotificationSettings.tsx`)

- La sezione "Email utenti" (toggle admin per ricevere copie email) resta, perché l'admin ha un'email configurata
- Rimuovere toggle email per-utente nella lista utenti (utenti non hanno più email)
- Mantenere toggle Telegram per-utente

### 10. Edge function `send-notification`

- Per gli **utenti**: rimuovere invio email, mantenere solo Telegram
- Per gli **admin**: mantenere invio email (usando `admin_contact_email` dal profilo) + Telegram

### 11. Edge function `daily-briefing`

- Rimuovere invio email per utenti
- Per admin: inviare email solo a `admin_contact_email` (non più al campo `email`)
- Mantenere invio Telegram per tutti

### 12. Pagina Reset Password (`ResetPassword.tsx`)

- Rimuoverla o disabilitarla (il reset avviene ora manualmente dall'admin)

### 13. Admin - Reset password manuale

Aggiungere pulsante nella tabella utenti del pannello admin:
- Click → dialog con nuova password generata automaticamente
- Chiama edge function che usa `supabase.auth.admin.updateUserById(userId, { password })`
- L'admin comunica la nuova password all'utente

---

### File da modificare

| File | Modifica |
|------|----------|
| `src/components/auth/AuthForm.tsx` | Login username, recupero password |
| `src/contexts/AuthContext.tsx` | signIn con username |
| `src/components/admin/AdminPanel.tsx` | Creazione con username, colonna tabella, pulsante reset password |
| `src/components/admin/AdminNotificationSettings.tsx` | Campo email admin, rimuovi email per-utente |
| `src/components/settings/NotificationSettings.tsx` | Rimuovi sezione email |
| `supabase/functions/admin-create-user/index.ts` | Username invece di email |
| `supabase/functions/generate-reset-link/index.ts` | Notifica admin invece di link diretto |
| `supabase/functions/send-notification/index.ts` | Rimuovi email utenti |
| `supabase/functions/daily-briefing/index.ts` | Rimuovi email utenti |
| `src/components/admin/CopyPortfolioDialog.tsx` | Mostra username invece di email |
| **Migrazione DB** | Aggiunta colonne `username`, `admin_contact_email` |

