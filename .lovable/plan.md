
# Piano: Correzione "$" a capo nella colonna UNIT (Covered Call IREN)

## Problema Identificato

Dallo screenshot, il testo nella colonna UNIT viene troncato e il simbolo "$" va a capo:
```
26,60
$
```

**Causa**: La colonna 8 nella griglia CSS ha una larghezza di soli `8rem`, che non è sufficiente per contenere il testo completo come `UNIT: 26,60 $ (+44,5%)`.

## Soluzione

Aumentare la larghezza della colonna 8 (UNIT) nel grid layout della `CoveredCallRow` da `8rem` a `10rem` o `11rem`.

### Modifica alla griglia CSS

**File**: `src/pages/Derivatives.tsx` (riga 606)

**Prima**:
```css
grid-cols-[auto_auto_minmax(8rem,1fr)_auto_auto_auto_auto_8rem_6rem_4.5rem_5rem_6rem]
                                                            ^^^^
                                                            colonna 8
```

**Dopo**:
```css
grid-cols-[auto_auto_minmax(8rem,1fr)_auto_auto_auto_auto_11rem_6rem_4.5rem_5rem_6rem]
                                                            ^^^^^
                                                            colonna 8 allargata
```

## File Coinvolti

| File | Modifica |
|------|----------|
| `src/pages/Derivatives.tsx` | Aumentare larghezza colonna 8 da `8rem` a `11rem` nella griglia `CoveredCallRow` (riga 606) |

## Risultato Atteso

| Prima | Dopo |
|-------|------|
| `26,60` <br> `$` | `UNIT: 26,60 $ (+44,5%)` |

Il testo rimarrà su un'unica riga grazie alla combinazione di:
1. `whitespace-nowrap` già presente sullo span
2. Larghezza colonna aumentata a `11rem`
