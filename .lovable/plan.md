

# Piano: Assegnare il Ruolo Admin al Tuo Utente

## Problema Identificato

Il tuo utente ha il ruolo `user` invece di `admin`. Quando navighi su `/admin`, il sistema verifica il ruolo e ti reindirizza alla homepage perché `isAdmin = false`.

## Soluzione

Aggiungere un record nella tabella `user_roles` con `role = 'admin'` per il tuo utente.

---

## Implementazione

### Migrazione Database

Eseguire una query per inserire il ruolo admin:

```sql
INSERT INTO user_roles (user_id, role)
VALUES ('7b625908-f303-4386-bd1c-a0727f77b5d1', 'admin');
```

---

## Struttura Attuale vs Desiderata

**Prima:**
```text
user_roles
┌────────────────────────────────────┬────────┐
│ user_id                            │ role   │
├────────────────────────────────────┼────────┤
│ 7b625908-f303-4386-bd1c-a0727f77b5d1 │ user   │
└────────────────────────────────────┴────────┘
```

**Dopo:**
```text
user_roles
┌────────────────────────────────────┬────────┐
│ user_id                            │ role   │
├────────────────────────────────────┼────────┤
│ 7b625908-f303-4386-bd1c-a0727f77b5d1 │ user   │
│ 7b625908-f303-4386-bd1c-a0727f77b5d1 │ admin  │  <-- NUOVO
└────────────────────────────────────┴────────┘
```

---

## Flusso di Verifica

```text
1. Utente naviga su /admin
2. AuthContext verifica user_roles WHERE role = 'admin'
3. Trova il record → isAdmin = true
4. AdminPanel si carica correttamente
```

---

## Dettagli Tecnici

La query nel file `AuthContext.tsx` cerca specificamente il ruolo `admin`:

```typescript
const { data } = await supabase
  .from('user_roles')
  .select('role')
  .eq('user_id', session.user.id)
  .eq('role', 'admin')  // <-- cerca questo specifico ruolo
  .maybeSingle();

setIsAdmin(!!data);  // true solo se trova il record
```

---

## Azioni da Eseguire

1. Inserire il ruolo admin nel database
2. Ricaricare la pagina (o effettuare logout/login) per aggiornare il contesto
3. Navigare su `/admin` per verificare l'accesso

---

## Risultato Atteso

Dopo l'inserimento del ruolo admin, potrai accedere al pannello di amministrazione su `/admin` e gestire gli utenti (aggiungere, rimuovere ruoli, eliminare utenti).

