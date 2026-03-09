

## Problema

Riga 286: `disabled={!pref.telegram_chat_id}` — il toggle Telegram per-utente è disabilitato quando l'utente non ha collegato Telegram. Ma questi toggle controllano le preferenze dell'**admin**, non dell'utente. L'admin deve poter attivare/disattivare liberamente la ricezione delle copie per qualsiasi utente, indipendentemente dallo stato Telegram dell'utente.

Dopo che il toggle generale propaga `notify_telegram=true` a tutti, gli utenti senza `telegram_chat_id` hanno lo switch su ON ma disabilitato → l'admin non può rimetterlo su OFF.

## Fix

**File: `src/components/admin/AdminNotificationSettings.tsx`**

- Rimuovere `disabled={!pref.telegram_chat_id}` dal Switch Telegram per-utente (riga 286)
- L'admin potrà così attivare/disattivare qualsiasi utente dopo aver usato il toggle generale

Una riga da cambiare.

