# Decisioni tecniche

- `supabase/functions/mcp/index.ts` è un bundle generato da `src/lib/mcp/` tramite il plugin `@lovable.dev/mcp-js`. Il banner "AUTO-GENERATED" è stato rimosso il 2026-09-29 per correggere gli errori di typecheck Deno (parametri `ctx` senza tipo persi dal bundler): il file è ora "owned", quindi ogni modifica a `src/lib/mcp/` va riportata a mano nel bundle (le annotazioni di tipo non sopravvivono al bundling).
- `resend@2.0.0` è elencato nel `package.json` radice solo perché il typecheck Deno delle edge function (daily-briefing, generate-reset-link, send-notification) risolva `npm:resend` senza `deno install`.
