
# Piano: Eliminazione Utente Demo + Edge Function Admin per Gestione Utenti

## Fase 1: Eliminazione Utente Demo

Elimineremo l'utente duplicato "NOME COGNOME" e tutti i suoi dati correlati dal database.

### Dati da Eliminare

| Tabella | Righe da eliminare |
|---------|-------------------|
| `positions` | 84 posizioni |
| `deposits` | Tutti i depositi |
| `historical_data` | Tutti i dati storici |
| `derivative_overrides` | Eventuali override |
| `portfolios` | 1 portfolio |
| `user_roles` | 1 ruolo |
| `profiles` | 1 profilo |
| `auth.users` | 1 utente |

### Ordine di Eliminazione (rispetto delle FK)

```text
1. positions         (dipende da portfolios)
2. deposits          (dipende da portfolios)
3. historical_data   (dipende da portfolios)
4. derivative_overrides (dipende da portfolios)
5. portfolios        (dipende da user_id)
6. user_roles        (dipende da user_id)
7. profiles          (dipende da user_id)
8. auth.users        (richiede service_role_key)
```

---

## Fase 2: Edge Function per Eliminazione Utenti

### Nuovo File: `supabase/functions/admin-delete-user/index.ts`

```typescript
// Endpoint: POST /admin-delete-user
// Body: { userId: string }
// Header: Authorization: Bearer <user_token>

// Logica:
1. Verifica che il chiamante sia admin (query user_roles)
2. Verifica che l'utente target esista
3. Impedisce l'auto-eliminazione
4. Elimina tutti i dati in ordine corretto
5. Elimina l'utente da auth.users usando service_role_key
```

### Sicurezza

- Verifica JWT del chiamante
- Controlla ruolo admin nel database
- Usa `SUPABASE_SERVICE_ROLE_KEY` (gia configurato) per eliminare da `auth.users`
- Log dell'operazione per audit

### Configurazione

```toml
# supabase/config.toml
[functions.admin-delete-user]
verify_jwt = false  # Validazione manuale nel codice
```

---

## Fase 3: Aggiornamento AdminPanel

### Modifiche a `src/components/admin/AdminPanel.tsx`

```typescript
// Prima (riga 138-144)
async function handleDeleteUser(userId: string) {
  toast.error('Eliminazione utenti richiede accesso diretto al backend');
}

// Dopo
async function handleDeleteUser(userId: string) {
  // 1. Mostra dialog di conferma
  // 2. Chiama edge function admin-delete-user
  // 3. Ricarica lista utenti
}
```

### Nuovi Elementi UI

- Dialog di conferma con nome utente
- Loading state durante l'eliminazione
- Protezione: impossibile eliminare se stessi
- Messaggio di successo/errore

---

## Flusso Completo

```text
┌─────────────────┐     click     ┌─────────────────┐
│  Admin Panel    │ ────────────► │ Confirm Dialog  │
│  (Trash icon)   │               │ "Vuoi eliminare │
└─────────────────┘               │  Mario Rossi?"  │
                                  └────────┬────────┘
                                           │ confirm
                                           ▼
                         ┌─────────────────────────────┐
                         │   Edge Function             │
                         │   admin-delete-user         │
                         │                             │
                         │ 1. Verifica admin           │
                         │ 2. Elimina posizioni        │
                         │ 3. Elimina portfolio        │
                         │ 4. Elimina profilo          │
                         │ 5. Elimina auth.users       │
                         └──────────────┬──────────────┘
                                        │
                                        ▼
                         ┌─────────────────────────────┐
                         │   Toast: "Utente eliminato" │
                         │   + Refresh lista           │
                         └─────────────────────────────┘
```

---

## File da Creare/Modificare

| File | Azione |
|------|--------|
| `supabase/functions/admin-delete-user/index.ts` | Creare (nuova edge function) |
| `supabase/config.toml` | Aggiungere configurazione function |
| `src/components/admin/AdminPanel.tsx` | Modificare handleDeleteUser |
| Database | Eliminare utente demo con migration |

---

## Dettaglio Tecnico: Edge Function

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 1. Verifica token chiamante
    const authHeader = req.headers.get("Authorization");
    const { data: { user: caller } } = await supabase.auth.getUser(
      authHeader?.replace("Bearer ", "")
    );

    if (!caller) {
      return new Response(JSON.stringify({ error: "Non autorizzato" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 2. Verifica ruolo admin
    const { data: adminRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .single();

    if (!adminRole) {
      return new Response(JSON.stringify({ error: "Richiede privilegi admin" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 3. Parse body
    const { userId } = await req.json();

    if (!userId || userId === caller.id) {
      return new Response(JSON.stringify({ error: "Operazione non permessa" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 4. Elimina dati in ordine
    // ... (posizioni, deposits, portfolios, user_roles, profiles)

    // 5. Elimina da auth.users
    const { error: authError } = await supabase.auth.admin.deleteUser(userId);

    if (authError) throw authError;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
```

---

## Risultato Atteso

Dopo l'implementazione:
- L'utente demo "NOME COGNOME" sara eliminato
- Il cron job aggiorneraA solo 17 azioni (il tuo portfolio)
- Dal pannello admin potrai eliminare/aggiungere utenti direttamente
