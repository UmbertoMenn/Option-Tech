

## Gestione notifiche per singolo utente dal pannello Admin

### Cosa cambia
Nel tab "Notifiche" dell'admin panel, sotto le impostazioni admin esistenti, aggiungo una sezione con la lista di tutti gli utenti non-admin. Per ciascuno mostro:
- Nome / Email
- Stato Telegram (collegato o no)
- Switch Email (legge/scrive `notify_email` sul profilo dell'utente)
- Switch Telegram (legge/scrive `notify_telegram`, disabilitato se Telegram non collegato)

### Implementazione

**File: `src/components/admin/AdminNotificationSettings.tsx`**

1. Dopo le card admin esistenti, aggiungo una nuova Card "Notifiche Utenti"
2. Fetch di tutti i profili (`profiles`) con `notify_email`, `notify_telegram`, `telegram_chat_id`, `email`, `full_name`, `user_id`
3. Per ogni utente (escluso l'admin corrente), mostro una riga con:
   - Nome/email a sinistra
   - Badge "Telegram ✓" se `telegram_chat_id` presente
   - Switch per `notify_email`
   - Switch per `notify_telegram` (disabled se no `telegram_chat_id`)
4. L'update usa `supabase.from('profiles').update({ notify_email/notify_telegram }).eq('user_id', targetUserId)` — funziona perché l'admin ha policy `Admins can view all profiles` per SELECT, ma manca la policy UPDATE per admin.

**Migrazione DB necessaria**: aggiungere RLS policy per permettere all'admin di aggiornare i profili degli utenti:
```sql
CREATE POLICY "Admins can update all profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));
```

### File da modificare
- `src/components/admin/AdminNotificationSettings.tsx` — aggiungere sezione utenti con switch per-user
- Migrazione DB — aggiungere policy UPDATE admin su `profiles`

