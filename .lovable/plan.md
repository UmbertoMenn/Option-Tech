
## Obiettivo
Far comparire **sempre** il tooltip “Benchmark” (e qualsiasi altro tooltip) anche dentro al carousel (che usa `overflow-hidden`), rendendolo quindi visibile e leggibile senza ulteriori tentativi a vuoto.

---

## Diagnosi (perché oggi il tooltip non appare)
Nel tuo progetto il componente `TooltipContent` (file `src/components/ui/tooltip.tsx`) **non usa un Portal** Radix.

Con Radix, se il contenuto del tooltip non viene “portaled” fuori dall’albero DOM corrente, allora:
- resta “dentro” al layout del grafico/carousel
- e viene **tagliato/clippato** da un parent con `overflow-hidden` (nel tuo caso il carousel: `CarouselContent` ha `overflow-hidden`)

Risultato: il tooltip può “aprirsi” logicamente, ma **non si vede** perché viene nascosto dal clipping del layout.

Questa è anche coerente col fatto che il problema si manifesta proprio nel grafico dentro il carousel.

---

## Soluzione (fix definitivo, 1 sola modifica strutturale)
### 1) Correggere il componente tooltip globale per usare Portal
**File:** `src/components/ui/tooltip.tsx`

**Cosa fare:**
- Wrappare `TooltipPrimitive.Content` in `TooltipPrimitive.Portal`

**Perché:**
- Il tooltip verrà renderizzato a livello `document.body` (o comunque fuori dai container con overflow)
- Non sarà più tagliato dal carousel o da altri contenitori

**Implementazione target (concetto):**
- Importare/uso di `TooltipPrimitive.Portal`
- Rendere:
  - `<TooltipPrimitive.Portal>`
    - `<TooltipPrimitive.Content ... />`
  - `</TooltipPrimitive.Portal>`

Opzionale ma consigliato:
- mantenere `z-50` (già presente)
- aggiungere `collisionPadding={8}` a `TooltipPrimitive.Content` per evitare che il tooltip finisca fuori schermo ai bordi.

---

## Miglioria mirata (solo benchmark, senza nested Provider)
### 2) Rendere immediato il tooltip del Benchmark senza “Provider annidati”
**File:** `src/components/dashboard/charts/PerformanceEvolutionChart.tsx`

**Cosa fare:**
- Rimuovere il `TooltipProvider` locale attorno al solo benchmark (non è necessario)
- Impostare `delayDuration={0}` direttamente su `<UITooltip ...>` (Radix lo supporta)

**Perché:**
- Riduce complessità e possibili conflitti
- Mantiene l’immediatezza solo dove serve (benchmark), lasciando gli altri tooltip con il comportamento globale.

Nota: questa parte non è strettamente necessaria per la visibilità; il Portal è il vero fix. È però una pulizia utile e “a prova di future regressions”.

---

## Verifiche (test rapidi, mirati, senza giri)
Dopo la modifica del Portal:

1) **Dashboard → Evoluzione Rendimento**
   - Passa il mouse su “Benchmark” nella legenda
   - Atteso: tooltip visibile (non clippato), testo leggibile, z-index corretto.

2) **Controllo regressioni veloce**
   - Vai in una pagina dove esistono già altri tooltip (es. Derivatives)
   - Atteso: continuano a funzionare (anzi, potenzialmente meglio ai bordi).

3) **Caso “difficile” (molto importante)**
   - Se il tooltip appare ma “lampeggia”, impostare `disableHoverableContent` (Radix) sul tooltip benchmark per evitare che il passaggio trigger→contenuto chiuda subito.

---

## Perché questa soluzione evita di “sprecare crediti”
- Non è un tweak cosmetico: è una **correzione architetturale** del componente tooltip.
- Risolve la causa tipica #1 dei tooltip invisibili in UI con carousel/modals/containers: **overflow clipping**.
- Una volta applicata, non richiede ulteriori tentativi specifici sul grafico.

---

## File interessati
- `src/components/ui/tooltip.tsx` (fix principale: Portal)
- `src/components/dashboard/charts/PerformanceEvolutionChart.tsx` (pulizia/robustezza: delayDuration sul Root, eventuali piccoli aggiustamenti)

---

## Edge case previsti
- Se il carousel o il grafico applicano `transform`/`filter` su un ancestor, il Portal evita comunque la maggior parte dei problemi di stacking/clipping.
- Se in futuro compaiono altri tooltip “invisibili”, questo fix li copre automaticamente perché è centralizzato.

