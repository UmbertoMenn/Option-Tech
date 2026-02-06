
# Piano: Rimuovere le Doppie Barre di Scorrimento dal Dialog Avvisi

## Problema Identificato

Il dialog "Gestione Avvisi" mostra due barre di scorrimento sovrapposte:

1. Una barra esterna sul `DialogContent` (causata da `overflow-y-auto` con `max-h-[85vh]`)
2. Una barra interna negli `ScrollArea` dentro ogni tab (con `h-[350px]`)

## Soluzione

Rimuovere gli `ScrollArea` interni dai TabsContent e lasciare che il `DialogContent` gestisca lo scrolling dell'intero dialog. Questo approccio:
- Mantiene un'unica barra di scorrimento
- Semplifica la struttura UI
- Migliora l'esperienza utente

## Modifiche Tecniche

### File: `src/components/derivatives/AlertSettingsDialog.tsx`

| Linea | Prima | Dopo |
|-------|-------|------|
| 392-393 | `<TabsContent value="distance"><ScrollArea className="h-[350px] pr-4">` | `<TabsContent value="distance" className="mt-4">` |
| 471-473 | `</ScrollArea></TabsContent>` | `</TabsContent>` |
| 476-477 | `<TabsContent value="ticker"><ScrollArea className="h-[350px] pr-4">` | `<TabsContent value="ticker" className="mt-4">` |
| 617-619 | `</ScrollArea></TabsContent>` | `</TabsContent>` |

### Dettaglio delle modifiche:

1. **Tab "Distanza"** (linee 392-473):
   - Rimuovere `<ScrollArea className="h-[350px] pr-4">` wrapper
   - Mantenere la struttura interna invariata

2. **Tab "Per Ticker"** (linee 476-619):
   - Rimuovere `<ScrollArea className="h-[350px] pr-4">` wrapper
   - Mantenere la struttura interna invariata

3. Gli altri tab (Azione, Cooldown, Notifiche) **non hanno** ScrollArea e rimangono invariati

## Risultato Finale

```text
PRIMA:
┌─ DialogContent (overflow-y-auto) ─┐
│ ┌─ ScrollArea (h-350px) ────────┐ │  ← 2 scrollbar
│ │  Contenuto tab                │ │
│ └───────────────────────────────┘ │
└───────────────────────────────────┘

DOPO:
┌─ DialogContent (overflow-y-auto) ─┐
│                                   │  ← 1 scrollbar
│  Contenuto tab                    │
│                                   │
└───────────────────────────────────┘
```

## Impatto Visivo

- Nessun cambiamento al layout o ai contenuti
- Esperienza di scroll più naturale e uniforme
- Coerenza con gli altri tab (Azione, Cooldown, Notifiche) che già non hanno ScrollArea
