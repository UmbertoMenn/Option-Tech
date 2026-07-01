/**
 * Ingestione automatica portafoglio da allegati email (Gmail).
 *
 * Flusso:
 *   1. Outlook aziendale → regola di inoltro verso una casella Gmail dedicata.
 *   2. Questo script (eseguito via GitHub Actions su cron) usa la Gmail API
 *      per cercare messaggi non letti dal mittente/oggetto del broker con
 *      allegato .xlsx/.xls.
 *   3. Scarica l'allegato, lo passa a parsePortfolioData/extractSnapshotDate
 *      (le STESSE funzioni usate da FileUploader.tsx, nessuna logica duplicata).
 *   4. Upserta le posizioni sul portfolio_id target con un client Supabase
 *      service-role (bypassa RLS: gira come processo di backend, non come utente).
 *   5. Marca il messaggio come letto (rimuove label UNREAD) così non viene
 *      rielaborato al giro successivo.
 *
 * DA CONFIGURARE (variabili d'ambiente / GitHub Secrets):
 *   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
 *   GMAIL_SENDER_FILTER   → es. "from:statements@broker.com has:attachment"
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   TARGET_PORTFOLIO_ID   → portfolio_id su cui scrivere le posizioni
 *
 * TODO (in sospeso, serve conferma di Umberto prima di andare in produzione):
 *   - Mapping email → portfolio_id se in futuro arrivano statement di PIÙ
 *     clienti sulla stessa casella (oggi: un solo TARGET_PORTFOLIO_ID fisso).
 *   - Notifica Telegram in caso di errore (canale già usato da daily-briefing).
 */
import { createClient } from '@supabase/supabase-js';
import * as XLSX from '@e965/xlsx';
import { parsePortfolioData, extractSnapshotDate } from '../../src/lib/excelParser';

const {
  GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET,
  GMAIL_REFRESH_TOKEN,
  GMAIL_SENDER_FILTER,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  TARGET_PORTFOLIO_ID,
} = process.env;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Variabile d'ambiente mancante: ${name}`);
  return value;
}

/** Scambia il refresh token per un access token Gmail valido ~1h. */
async function getGmailAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('GMAIL_CLIENT_ID', GMAIL_CLIENT_ID),
      client_secret: requireEnv('GMAIL_CLIENT_SECRET', GMAIL_CLIENT_SECRET),
      refresh_token: requireEnv('GMAIL_REFRESH_TOKEN', GMAIL_REFRESH_TOKEN),
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Gmail OAuth refresh fallito: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token as string;
}

interface GmailMessageRef { id: string; }

/** Cerca messaggi non letti che matchano il filtro (sintassi ricerca Gmail). */
async function findUnreadMessages(accessToken: string): Promise<GmailMessageRef[]> {
  const q = encodeURIComponent(`is:unread ${GMAIL_SENDER_FILTER || 'has:attachment'}`);
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Gmail search fallita: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (data.messages || []) as GmailMessageRef[];
}

interface GmailAttachment { filename: string; data: Uint8Array; }

async function getAttachments(accessToken: string, messageId: string): Promise<GmailAttachment[]> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Gmail get message fallita: ${res.status} ${await res.text()}`);
  const msg = await res.json();

  const out: GmailAttachment[] = [];
  const walk = async (part: any) => {
    if (part.filename && /\.(xlsx|xls)$/i.test(part.filename) && part.body?.attachmentId) {
      const attRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${part.body.attachmentId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!attRes.ok) return;
      const att = await attRes.json();
      // Gmail usa base64url
      const b64 = (att.data as string).replace(/-/g, '+').replace(/_/g, '/');
      const buf = Buffer.from(b64, 'base64');
      out.push({ filename: part.filename, data: new Uint8Array(buf) });
    }
    if (part.parts) for (const p of part.parts) await walk(p);
  };
  await walk(msg.payload);
  return out;
}

async function markAsRead(accessToken: string, messageId: string): Promise<void> {
  await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    },
  );
}

async function main() {
  const supabase = createClient(
    requireEnv('SUPABASE_URL', SUPABASE_URL),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY),
  );
  const portfolioId = requireEnv('TARGET_PORTFOLIO_ID', TARGET_PORTFOLIO_ID);

  const accessToken = await getGmailAccessToken();
  const messages = await findUnreadMessages(accessToken);
  console.log(`[email-ingest] ${messages.length} messaggi non letti da elaborare`);

  for (const m of messages) {
    const attachments = await getAttachments(accessToken, m.id);
    if (attachments.length === 0) {
      console.log(`[email-ingest] ${m.id}: nessun allegato .xlsx/.xls, salto (NON marcato come letto)`);
      continue;
    }

    for (const att of attachments) {
      try {
        const workbook = XLSX.read(att.data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

        const snapshotDate = extractSnapshotDate(rows);
        const { positions, cashValue } = parsePortfolioData(rows);

        if (positions.length === 0) {
          console.warn(`[email-ingest] ${att.filename}: nessuna posizione trovata, salto`);
          continue;
        }

        // Upsert posizioni: sostituisce le posizioni correnti del portfolio,
        // stesso comportamento di updatePositionsAsync usato da FileUploader.
        await supabase.from('positions').delete().eq('portfolio_id', portfolioId);
        const { error: insErr } = await supabase.from('positions').insert(
          positions.map(p => ({ ...p, portfolio_id: portfolioId })),
        );
        if (insErr) throw insErr;

        await supabase.from('portfolios').update({
          cash_value: cashValue > 0 ? cashValue : undefined,
          snapshot_date: snapshotDate,
        }).eq('id', portfolioId);

        console.log(`[email-ingest] ${att.filename}: ${positions.length} posizioni importate (snapshot ${snapshotDate ?? 'n/d'})`);

        // NB: qui manca ancora upsertUploadSnapshot (storico) e
        // refreshStrategyCacheForPortfolio — da portare allo stesso modo
        // prima di andare in produzione, sono entrambi già isolabili da
        // logica UI così come parsePortfolioData.
      } catch (err) {
        console.error(`[email-ingest] Errore elaborando ${att.filename}:`, err);
        throw err; // non marcare il messaggio come letto se qualcosa fallisce
      }
    }

    await markAsRead(accessToken, m.id);
  }
}

main().catch((err) => {
  console.error('[email-ingest] Fallito:', err);
  process.exit(1);
});
