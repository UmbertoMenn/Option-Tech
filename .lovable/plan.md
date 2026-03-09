

## Fix: Toggle admin solo per l'admin, rimuovere propagazione

Il problema e' chiaro: i toggle "Email utenti" e "Telegram utenti" nella sezione Admin devono controllare **solo** se l'admin riceve le copie delle notifiche. Non devono propagare nulla agli utenti.

### Modifiche

**File: `src/components/admin/AdminNotificationSettings.tsx`**

1. **Rimuovere la logica di propagazione batch** nella funzione `updateSetting`:
   - Eliminare il blocco che fa `supabase.from('profiles').update({ [userField]: value }).neq('user_id', user!.id)`
   - Eliminare l'aggiornamento locale di `setUserProfiles` legato alla propagazione
   - Mantenere solo l'update del campo admin (`admin_notify_email` / `admin_notify_telegram`) sul profilo dell'admin

2. **La sezione "Notifiche Utenti" per-utente resta invariata** come vista di monitoraggio per l'admin (read-only view dello stato attuale degli utenti), con possibilita' di override manuale per singolo utente tramite `updateUserSetting`.

### Risultato
- Toggle "Email utenti" ON/OFF → cambia solo `admin_notify_email` sull'admin
- Toggle "Telegram utenti" ON/OFF → cambia solo `admin_notify_telegram` sull'admin
- Nessuna modifica ai profili degli utenti
- Gli utenti gestiscono le proprie notifiche autonomamente

