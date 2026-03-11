

## Fix: Gestione corretta dello sfasamento ora legale US/EU

### Problema
Il codice in `src/lib/marketHours.ts` calcola gli orari del mercato US come fissi a **15:30-22:00 CET**. Ma questo è corretto solo quando sia US che EU sono nella stessa modalità (entrambi standard o entrambi DST). Durante il gap (2a domenica di marzo → ultima domenica di marzo, e 1a domenica di novembre → ultima domenica di ottobre), gli orari US in tempo italiano cambiano:
- **US su EDT, EU su CET** (circa 2 settimane a marzo): mercato US apre **14:30-21:00 CET**
- **US su EST, EU su CEST** (circa 1 settimana a novembre): mercato US apre **16:30-23:00 CEST**

Lo stesso problema è presente nel frontend (`isMarketOpen`) che mostra "Mercato chiuso" erroneamente. Le edge functions `check-alerts` usano già correttamente l'offset ET indipendente, quindi non sono affette.

### Soluzione

**`src/lib/marketHours.ts`** — Riscrivere la logica US per calcolare l'orario in **Eastern Time** (usando le regole DST americane: 2a domenica di marzo, 1a domenica di novembre), e poi verificare se sono le 9:30-16:00 ET, invece di convertire tutto in CET.

Implementazione:
1. Aggiungere una funzione `getETOffset(date)` che calcola UTC-4 (EDT) o UTC-5 (EST) usando le regole DST americane
2. Nel ramo US di `isMarketOpen`, convertire l'ora corrente in ET e verificare 9:30-16:00 ET
3. Nel ramo EU, mantenere la logica CET/CEST esistente (9:00-17:30 CET/CEST)

Questo elimina il problema alla radice: non dipende più dal confronto CET/ET con offset fisso.

### File da modificare
- `src/lib/marketHours.ts` — aggiungere `getETOffset`, riscrivere ramo US in `isMarketOpen`

