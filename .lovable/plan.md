
Obiettivo: ripristinare i tooltip dei badge “OTM/ITM/IB/OOB/IR/OOR” nella pagina Derivati in modo stabile (non workaround “a caso”), identificando la causa reale e applicando una fix strutturale.

---

## Diagnosi approfondita (root cause)

### 1) Dove si rompe
Nel file `src/pages/Derivatives.tsx` i tooltip “problematici” sono quasi tutti costruiti così:

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <Badge ...>OTM</Badge>
  </TooltipTrigger>
  <TooltipContent>...</TooltipContent>
</Tooltip>
```

Esempi reali nel codice:
- `GroupedOptionLegRow`: badge `ITM/OTM` (riga ~1709+)
- `GroupedOtherStrategyRow`: badge `IB/OOB` e `IR/OOR` (righe ~1550+)
- altre righe strategie usano lo stesso pattern

Quindi i trigger dei tooltip sono “Badge” come child.

### 2) Perché Radix Tooltip non si attiva con quel pattern
Il componente `Badge` attuale (`src/components/ui/badge.tsx`) è un normale function component che **NON** usa `React.forwardRef`.

Radix (TooltipTrigger) quando usi `asChild` deve poter:
- attaccare **ref** al nodo DOM reale del trigger
- comporre handler di pointer/focus sul trigger

Con `asChild`, il ref viene passato al child. Se il child è un component React che **non forwarda il ref** verso il `<div>`, Radix non riesce ad “agganciarsi” correttamente al trigger. Risultato tipico: tooltip che non appare (o comportamento intermittente), e spesso in console appare anche un warning del tipo:
- “Function components cannot be given refs…”

Nel tuo progetto:
- `Badge` renderizza un `<div {...props} />` ma **non** forwarda `ref` → per Radix è un trigger “non affidabile”.
- Questo spiega perfettamente perché “OTM/ITM/IB/OOB ecc.” (tutti badge) non funzionano, mentre altri tooltip con trigger DOM nativi (`<span>`, icone lucide `forwardRef`, `<button>`) tendono a funzionare.

### 3) Perché i fix precedenti non hanno risolto
I fix precedenti (stopPropagation / rimozione `CollapsibleTrigger asChild` su wrapper di riga) risolvono conflitti di click/hover tra contenitori interattivi, ma **non** risolvono il problema strutturale: il trigger del tooltip (Badge) non supporta ref quando usato con `asChild`.

---

## Soluzione proposta (robusta)

### A) Fix principale: rendere `Badge` compatibile con Radix `asChild`
Aggiornare `src/components/ui/badge.tsx` trasformando `Badge` in `React.forwardRef<HTMLDivElement, BadgeProps>`.

Cosa cambia:
- il `ref` viene inoltrato al `<div>` reale
- Radix TooltipTrigger riesce a gestire correttamente trigger/posizionamento/eventi
- tutte le istanze `TooltipTrigger asChild` + `<Badge>` in tutta l’app smettono di essere fragili

Deliverable:
- `Badge.displayName = "Badge"`
- export invariato: `export { Badge, badgeVariants }` (nessun refactor nei consumers)

### B) Hardening (opzionale ma consigliato): audit di altri trigger “asChild”
Fare una mini-verifica su eventuali altri componenti custom usati come child di:
- `TooltipTrigger asChild`
- `DropdownMenuTrigger asChild`
- ecc.

Nel tuo repo, l’uso più critico è `TooltipTrigger asChild` con `Badge`. Altri casi (es. `<Button>`, icone lucide) sono già `forwardRef` o DOM nativi.

### C) Test manuale mirato (riduce spreco crediti)
Checklist di test in preview:
1. Vai su `/derivatives`
2. Hover su badge:
   - OTM/ITM (nelle righe opzioni)
   - IB/OOB e IR/OOR (nelle righe strategie raggruppate)
3. Verifica:
   - tooltip appare immediatamente (o con delay standard)
   - non viene “tagliato” (Portal già presente)
   - cliccare sul badge non rompe il collapsible (lo stopPropagation è già presente dove serve)

### D) Regressioni da controllare
Perché `Badge` è usato ovunque, verificare velocemente anche:
- tooltips in altre pagine che usano badge come trigger (se presenti)
- stili badge invariati (classi tailwind e cva restano uguali)

---

## File coinvolti

1) `src/components/ui/badge.tsx`
- Modifica: `Badge` → `React.forwardRef`
- Nessuna modifica API esterna (props/exports)

2) (Nessuna modifica necessaria) `src/pages/Derivatives.tsx`
- Dovrebbe “magicamente” iniziare a funzionare senza toccare ogni tooltip, perché il bug è nel trigger component.

---

## Perché questa è la fix “giusta”
- Non è un workaround locale su una singola riga
- Risolve il problema alla radice (contratto richiesto da Radix quando si usa `asChild`)
- Evita di dover riscrivere decine di tooltip
- Riduce probabilità di ricadute future quando aggiungi nuovi tooltip su Badge

---

## Criteri di completamento
- Tooltip su badge OTM/ITM/IB/OOB/IR/OOR visibili e consistenti al hover/focus
- Nessun warning React “ref” correlato a Badge quando si aprono pagine che li usano come trigger
- Nessun impatto sul layout/stile dei badge
