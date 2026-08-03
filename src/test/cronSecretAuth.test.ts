import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';

/**
 * Regressione: incidente del 2026-07-22.
 *
 * Il commit "Fixed security issues" ha aggiunto alle edge function cron un
 * controllo di questo tipo:
 *
 *   const cronSecret = Deno.env.get("CRON_SECRET");
 *   if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) -> 401
 *
 * La env var CRON_SECRET non e' mai stata configurata su Supabase, mentre i job
 * pg_cron e il trigger notify_on_new_alert inviano il segreto preso dal Vault
 * (vault.decrypted_secrets, name = 'cron_secret'). Risultato: 401 su ogni
 * chiamata, prezzi sottostanti/opzioni fermi, alert e notifiche bloccati.
 *
 * Questi test bloccano il ritorno del pattern "solo env var": la validazione
 * deve sempre poter ricadere sulla RPC verify_cron_secret, che legge il Vault
 * (unica fonte di verita', condivisa con i chiamanti).
 */

const FUNCTIONS_DIR = path.resolve(__dirname, '../../supabase/functions');
const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations');

const CRON_AUTHENTICATED_FUNCTIONS = [
  'check-alerts',
  'send-notification',
  'update-erp-cron',
  'update-option-prices-cron',
  'update-underlying-prices-cron',
];

function readFunctionSource(name: string): string {
  const file = path.join(FUNCTIONS_DIR, name, 'index.ts');
  expect(existsSync(file), `edge function mancante: ${name}`).toBe(true);
  return readFileSync(file, 'utf8');
}

function readLatestNotifyTriggerMigration(): string {
  const definitions = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({
      file,
      sql: readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'),
    }))
    .filter(({ sql }) =>
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.notify_on_new_alert\s*\(\s*\)/i.test(sql),
    );

  expect(definitions.length, 'definizione versionata di notify_on_new_alert mancante').toBeGreaterThan(0);
  return definitions.at(-1)!.sql;
}

/** Rimuove i commenti SQL: le asserzioni devono guardare il codice, non le note. */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .map((line) => line.replace(/\s--.*$/, ''))
    .join('\n');
}

/** Pattern esatto del bug: guardia che dipende solo dalla env var. */
export function hasEnvOnlyCronGuard(source: string): boolean {
  return /if\s*\(\s*!cronSecret\s*\|\|\s*req\.headers\.get\(\s*['"]x-cron-secret['"]\s*\)\s*!==\s*cronSecret\s*\)/.test(
    source,
  );
}

/** La validazione deve passare (anche) dalla RPC che legge il Vault. */
export function usesVaultBackedVerification(source: string): boolean {
  return source.includes('verify_cron_secret');
}

describe('autenticazione cron delle edge function', () => {
  it('prova del bug: la vecchia guardia env-only viene riconosciuta', () => {
    const buggy = `
      const cronSecret = Deno.env.get("CRON_SECRET");
      if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
    `;
    expect(hasEnvOnlyCronGuard(buggy)).toBe(true);
    expect(usesVaultBackedVerification(buggy)).toBe(false);
  });

  it.each(CRON_AUTHENTICATED_FUNCTIONS)(
    '%s non usa una guardia basata solo su CRON_SECRET',
    (name) => {
      expect(hasEnvOnlyCronGuard(readFunctionSource(name))).toBe(false);
    },
  );

  it.each(CRON_AUTHENTICATED_FUNCTIONS)(
    '%s valida il segreto tramite la RPC verify_cron_secret (Vault)',
    (name) => {
      expect(usesVaultBackedVerification(readFunctionSource(name))).toBe(true);
    },
  );

  it.each(CRON_AUTHENTICATED_FUNCTIONS)(
    '%s rifiuta comunque le richieste senza header x-cron-secret',
    (name) => {
      const source = readFunctionSource(name);
      expect(source).toContain('req.headers.get("x-cron-secret")');
      expect(source).toContain('if (!provided) return false;');
    },
  );

  it('nessuna altra edge function reintroduce la guardia env-only', () => {
    const offenders = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => existsSync(path.join(FUNCTIONS_DIR, name, 'index.ts')))
      .filter((name) => hasEnvOnlyCronGuard(readFunctionSource(name)));

    expect(offenders).toEqual([]);
  });

  it('la migrazione della RPC verify_cron_secret e la sua GRANT sono versionate', () => {
    const sql = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
      .join('\n');

    expect(sql).toContain('FUNCTION public.verify_cron_secret');
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.verify_cron_secret\(text\) TO service_role/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.verify_cron_secret\(text\) FROM PUBLIC, anon, authenticated/);
  });

  it('il trigger alert invia a send-notification il cron_secret letto dal Vault', () => {
    const sql = readLatestNotifyTriggerMigration();

    expect(sql).toMatch(/FROM\s+vault\.decrypted_secrets/i);
    expect(sql).toMatch(/WHERE\s+name\s*=\s*'cron_secret'/i);
    expect(sql).toMatch(/net\.http_post\s*\(/i);
    expect(sql).toMatch(/['"]x-cron-secret['"]\s*,\s*v_cron_secret/i);
  });

  /**
   * Regressione: l'header Authorization del trigger veniva costruito con
   * `'Bearer ' || current_setting('supabase.service_role_key', true)`. Quella
   * GUC non esiste nel database, quindi la concatenazione produce NULL e
   * jsonb_build_object emette 'Authorization': null. Passa solo finche'
   * send-notification resta con verify_jwt = false: al ripristino della
   * verifica JWT le notifiche sparirebbero in silenzio.
   */
  it('il trigger alert non costruisce Authorization da una GUC inesistente', () => {
    const sql = stripSqlComments(readLatestNotifyTriggerMigration());

    expect(sql).not.toMatch(/current_setting\(\s*'supabase\.service_role_key'/i);
    expect(sql).toMatch(/['"]Authorization['"]\s*,\s*'Bearer '\s*\|\|/i);
    expect(sql).toMatch(/['"]apikey['"]\s*,/i);
  });

  it('il trigger alert fissa un timeout esplicito su net.http_post', () => {
    const sql = readLatestNotifyTriggerMigration();
    expect(sql).toMatch(/timeout_milliseconds\s*:=\s*\d+/i);
  });
});
