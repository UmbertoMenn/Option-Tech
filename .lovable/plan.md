
# Piano: Sistema di Notifiche Ibrido Email + Telegram

## Panoramica

Implementazione di un sistema di notifiche in tempo reale che invia avvisi via Email (Resend) e Telegram quando viene creato un nuovo alert nel sistema.

```text
┌─────────────────┐     ┌──────────────┐     ┌────────────────────┐
│  check-alerts   │────▶│    INSERT    │────▶│  Database Trigger  │
│  (Edge Fn)      │     │   alerts     │     │  on_new_alert      │
└─────────────────┘     └──────────────┘     └─────────┬──────────┘
                                                       │
                                                       ▼
                                             ┌────────────────────┐
                                             │  send-notification │
                                             │  (Edge Function)   │
                                             └─────────┬──────────┘
                                                       │
                              ┌────────────────────────┼────────────────────────┐
                              ▼                        ▼                        ▼
                     ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
                     │    Email     │         │   Telegram   │         │    Admin     │
                     │  (Resend)    │         │   (Bot API)  │         │  Notifiche   │
                     └──────────────┘         └──────────────┘         └──────────────┘
```

---

## Fase 1: Aggiornamento Schema Database

### 1.1 Estendere tabella `profiles`

Aggiungere campi per preferenze notifiche:

```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS 
  notify_email boolean DEFAULT true;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS 
  notify_telegram boolean DEFAULT false;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS 
  telegram_chat_id text;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS 
  is_admin boolean DEFAULT false;
```

### 1.2 Creare tabella `notification_logs`

Per tracciare le notifiche inviate:

```sql
CREATE TABLE public.notification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid REFERENCES public.alerts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  channel text NOT NULL, -- 'email' | 'telegram'
  status text NOT NULL,  -- 'sent' | 'failed'
  error_message text,
  created_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notification logs"
  ON public.notification_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
```

### 1.3 Creare Database Trigger

```sql
CREATE OR REPLACE FUNCTION notify_on_new_alert()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://uareyloxlpvaxmzygpgo.supabase.co/functions/v1/send-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
    ),
    body := jsonb_build_object(
      'alert_id', NEW.id,
      'user_id', NEW.user_id,
      'ticker', NEW.ticker,
      'message', NEW.message,
      'severity', NEW.severity,
      'alert_type', NEW.alert_type
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_new_alert
  AFTER INSERT ON public.alerts
  FOR EACH ROW
  EXECUTE FUNCTION notify_on_new_alert();
```

---

## Fase 2: Edge Function `send-notification`

### 2.1 Struttura

```text
supabase/functions/send-notification/index.ts
```

### 2.2 Logica Principale

```typescript
// Pseudo-codice della logica
async function handleNotification(alertData) {
  // 1. Recupera profilo utente
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name, notify_email, notify_telegram, telegram_chat_id')
    .eq('user_id', alertData.user_id)
    .single();
  
  // 2. Recupera admin (per notifiche admin)
  const { data: admins } = await supabase
    .from('profiles')
    .select('email, telegram_chat_id, notify_email, notify_telegram')
    .eq('is_admin', true);
  
  // 3. Invia Email se abilitato
  if (profile.notify_email) {
    await sendEmail(profile.email, alertData);
  }
  
  // 4. Invia Telegram se abilitato
  if (profile.notify_telegram && profile.telegram_chat_id) {
    await sendTelegram(profile.telegram_chat_id, alertData);
  }
  
  // 5. Notifica admin
  for (const admin of admins) {
    if (admin.notify_email) await sendEmail(admin.email, alertData, true);
    if (admin.notify_telegram && admin.telegram_chat_id) {
      await sendTelegram(admin.telegram_chat_id, alertData, true);
    }
  }
}
```

### 2.3 Template Email

```html
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: #dc2626; color: white; padding: 16px; border-radius: 8px 8px 0 0;">
    <h2>⚠️ Avviso Portfolio: ${ticker}</h2>
  </div>
  <div style="padding: 20px; background: #f9fafb; border-radius: 0 0 8px 8px;">
    <p style="font-size: 16px; color: #111827;">${message}</p>
    <table style="margin-top: 16px;">
      <tr><td>Severità:</td><td><strong>${severity}</strong></td></tr>
      <tr><td>Tipo:</td><td>${alert_type}</td></tr>
      <tr><td>Data:</td><td>${created_at}</td></tr>
    </table>
    <a href="https://app.example.com/derivatives" 
       style="display: inline-block; margin-top: 20px; padding: 12px 24px; 
              background: #2563eb; color: white; text-decoration: none; 
              border-radius: 6px;">
      Visualizza Portafoglio
    </a>
  </div>
</div>
```

### 2.4 Template Telegram

```text
🚨 *Avviso Portfolio*

📈 *Ticker:* ${ticker}
📝 *Messaggio:* ${message}
⚡ *Severità:* ${severity}

🔗 [Visualizza Dettagli](https://app.example.com/derivatives)
```

---

## Fase 3: Setup Telegram Bot

### 3.1 Creare Bot

1. Chattare con @BotFather su Telegram
2. Comando: `/newbot`
3. Scegliere nome: "Portfolio Alert Bot"
4. Salvare il token API

### 3.2 Edge Function per Linking

Creare `supabase/functions/telegram-link/index.ts`:

- Genera codice temporaneo univoco per l'utente
- Quando l'utente invia il codice al bot, associa il `chat_id` al profilo

```text
Flusso Utente:
1. Clicca "Collega Telegram" nell'app
2. Riceve codice univoco (es: "LINK-A7F3K2")
3. Invia codice al bot Telegram
4. Bot verifica e salva chat_id nel profilo
5. Conferma collegamento
```

---

## Fase 4: UI per Preferenze Notifiche

### 4.1 Nuovo componente: `NotificationSettings.tsx`

```typescript
// Checkbox per Email e Telegram
// Pulsante per collegare Telegram
// Indicatore stato collegamento

<Card>
  <CardHeader>
    <CardTitle>Preferenze Notifiche</CardTitle>
  </CardHeader>
  <CardContent>
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>Notifiche Email</Label>
        <Switch checked={notifyEmail} onCheckedChange={...} />
      </div>
      <div className="flex items-center justify-between">
        <Label>Notifiche Telegram</Label>
        <Switch checked={notifyTelegram} onCheckedChange={...} />
      </div>
      {notifyTelegram && !telegramChatId && (
        <Button onClick={linkTelegram}>
          <Send className="mr-2 h-4 w-4" />
          Collega Telegram
        </Button>
      )}
      {telegramChatId && (
        <Badge variant="success">Telegram collegato ✓</Badge>
      )}
    </div>
  </CardContent>
</Card>
```

---

## Fase 5: Secrets Richiesti

| Secret | Descrizione | Come ottenerlo |
|--------|-------------|----------------|
| `RESEND_API_KEY` | API key Resend | https://resend.com/api-keys |
| `TELEGRAM_BOT_TOKEN` | Token bot Telegram | Da @BotFather |

---

## File da Creare/Modificare

| File | Azione | Descrizione |
|------|--------|-------------|
| Database Migration | Creare | Estensione profiles + notification_logs + trigger |
| `supabase/functions/send-notification/index.ts` | Creare | Edge function per invio notifiche |
| `supabase/functions/telegram-link/index.ts` | Creare | Edge function per collegamento Telegram |
| `src/components/settings/NotificationSettings.tsx` | Creare | UI preferenze notifiche |
| `src/hooks/useNotificationSettings.ts` | Creare | Hook per gestione preferenze |
| `supabase/config.toml` | Modificare | Aggiungere nuove edge functions |

---

## Ordine di Implementazione

1. **Database**: Migrazione schema (profiles, notification_logs, trigger)
2. **Secrets**: Richiedere RESEND_API_KEY e TELEGRAM_BOT_TOKEN
3. **Edge Functions**: send-notification e telegram-link
4. **Frontend**: NotificationSettings component e hook
5. **Config**: Aggiornare supabase/config.toml
6. **Testing**: Verificare flusso end-to-end

---

## Note Tecniche

- Il trigger usa `pg_net` per chiamare l'edge function in modo asincrono
- Le notifiche admin vengono inviate in parallelo a quelle utente
- I log delle notifiche permettono di tracciare errori e retry
- Il collegamento Telegram usa codici con scadenza di 10 minuti
- L'email usa Resend per alta deliverability e template HTML responsive
