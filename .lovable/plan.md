

## Correzione: Rimuovere grassetto da GP e ML

Ho erroneamente mantenuto `font-semibold` sui valori GP e ML nelle sezioni Iron Condor e Double Diagonal.

### Modifiche

**File: `src/pages/Derivatives.tsx`**

1. **IronCondorRow - GP (linea ~905)**
   - Da: `<span className="font-semibold text-sm">`
   - A: `<span className="text-sm">`

2. **IronCondorRow - ML (linea ~918)**
   - Da: `<span className="font-semibold text-sm">`
   - A: `<span className="text-sm">`

3. **DoubleDiagonalRow - GP (linea ~1114)**
   - Da: `<span className="font-semibold text-sm">`
   - A: `<span className="text-sm">`

4. **DoubleDiagonalRow - ML (linea ~1127)**
   - Da: `<span className="font-semibold text-sm">`
   - A: `<span className="text-sm">`

