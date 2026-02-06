
# Piano: Fix Reset Password Link in Preview

## Problema Identificato

Il flusso attuale fallisce perché:

1. L'email di reset contiene un link tipo: `https://...supabase.co/auth/v1/verify?token=...&type=recovery&redirect_to=https://preview.../reset-password`
2. Supabase verifica il token e fa redirect a: `https://preview.../reset-password#access_token=...&type=recovery`
3. Lovable intercetta e chiede login alla piattaforma
4. Durante questo redirect, il fragment (`#...`) viene perso
5. La pagina `/reset-password` non trova il token e mostra "Link non valido"

## Soluzione: Uso di token_hash + verifyOtp

Invece di usare il flow automatico con fragments, useremo query parameters che sopravvivono ai redirect.

### Modifiche Necessarie

#### 1. Edge Function per generare link personalizzato

Creare una edge function che usa `supabase.auth.admin.generateLink()` per generare un link di recovery con `token_hash` estratto manualmente.

```typescript
// supabase/functions/generate-reset-link/index.ts
const { data } = await supabase.auth.admin.generateLink({
  type: 'recovery',
  email: email,
});

const tokenHash = data.properties.hashed_token;
const resetUrl = `${origin}/reset-password?token_hash=${tokenHash}&type=recovery`;
```

#### 2. Modifica AuthForm.tsx

Chiamare la nuova edge function invece di `resetPasswordForEmail`:

```typescript
// Invece di:
await supabase.auth.resetPasswordForEmail(email, { redirectTo: ... });

// Useremo:
const response = await fetch('/functions/v1/generate-reset-link', {
  method: 'POST',
  body: JSON.stringify({ email, origin: window.location.origin })
});
```

#### 3. Modifica ResetPassword.tsx

Usare `verifyOtp` con i query parameters:

```typescript
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  
  if (tokenHash && type === 'recovery') {
    supabase.auth.verifyOtp({ 
      token_hash: tokenHash, 
      type: 'recovery' 
    }).then(({ error }) => {
      if (error) {
        setError('Link scaduto o non valido');
      } else {
        setLoading(false); // Mostra form password
      }
    });
  }
}, []);
```

### File da Modificare/Creare

1. `supabase/functions/generate-reset-link/index.ts` - Nuova edge function
2. `supabase/config.toml` - Aggiungere config per la nuova function  
3. `src/components/auth/AuthForm.tsx` - Chiamare edge function
4. `src/pages/ResetPassword.tsx` - Usare verifyOtp con query params

### Flusso Corretto

```text
PRIMA (non funziona):
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ Richiedi │────▶│ Email    │────▶│ Supabase │────▶│ Redirect │
│  Reset   │     │ con link │     │ Verify   │     │ con #    │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                                                        │
                                        ┌───────────────▼───────────────┐
                                        │ Lovable login intercetta      │
                                        │ Fragment # PERSO!             │
                                        └───────────────────────────────┘

DOPO (funziona):
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ Richiedi │────▶│ Edge     │────▶│ Email    │────▶│ Redirect │
│  Reset   │     │ Function │     │ con link │     │ con ?    │
└──────────┘     └──────────┘     │ diretto  │     │ params   │
                                  └──────────┘     └──────────┘
                                                        │
                                        ┌───────────────▼───────────────┐
                                        │ Query params sopravvivono     │
                                        │ verifyOtp() valida token      │
                                        └───────────────────────────────┘
```

### Ordine di Implementazione

1. Creare edge function `generate-reset-link`
2. Aggiornare `supabase/config.toml`
3. Modificare `AuthForm.tsx` per usare la nuova edge function
4. Modificare `ResetPassword.tsx` per usare `verifyOtp` con query params
5. Testare il flusso completo

### Note Tecniche

- La edge function usa `supabase.auth.admin.generateLink()` che richiede il service role key
- Il `token_hash` viene passato via query string che sopravvive ai redirect
- `verifyOtp` crea una sessione valida, permettendo poi `updateUser({ password })`
- L'email viene inviata usando Resend (gia configurato)
