

# Piano: Carousel Grafici Performance Storiche

## Obiettivo
Creare un nuovo carousel da posizionare sotto al grafico principale (torta nella vista Base, barre nelle viste Netting) che mostri tre tipi di visualizzazioni dei dati storici:

1. **Slide 1 - Evoluzione Rendimento**: Grafico lineare con rendimento % e valore assoluto P/L nel tempo
2. **Slide 2 - Rendimento per Anno**: Istogramma con rendimento % per ogni anno
3. **Slide 3 - Evoluzione Patrimonio**: Grafico lineare dell'andamento del valore patrimoniale nel tempo

Tutti i grafici devono adattarsi dinamicamente alla viewMode selezionata (Base, Netting ex. Covered Call, Netting ex. CC e NP, Netting Totale).

---

## Architettura Componenti

```text
Dashboard.tsx
└── DynamicPortfolioChart (grafico principale esistente)
└── HistoricalChartsCarousel (NUOVO)
    ├── PerformanceEvolutionChart (Slide 1)
    ├── YearlyReturnChart (Slide 2)
    └── PortfolioEvolutionChart (Slide 3)
```

---

## Dettagli Tecnici

### Nuovo Componente: `HistoricalChartsCarousel.tsx`

**Props**:
- `historicalData: HistoricalDataEntry[]` - dati storici dal DB
- `viewMode: ViewMode` - vista corrente (base, netting_total, netting_ex_cc, netting_ex_cc_np)
- `currentValue: number` - valore attuale del patrimonio (per aggiungere punto "oggi" ai grafici)
- `currentDate: string | null` - data snapshot attuale

**Struttura**:
- Utilizza i componenti Carousel esistenti (`Carousel`, `CarouselContent`, `CarouselItem`, `CarouselPrevious`, `CarouselNext`)
- Ogni slide e una Card con titolo e grafico Recharts
- Indicatori pallini per navigazione (come il ViewModeSelector esistente)

---

### Slide 1: Evoluzione Rendimento (LineChart)

**Dati da mostrare**:
- Asse X: date degli snapshot
- Asse Y primario: Rendimento % cumulativo
- Asse Y secondario (opzionale): Valore assoluto P/L

**Calcolo rendimento**:
Per ogni snapshot (partendo dal piu vecchio come base):
```
P/L = valore_snapshot - valore_iniziale - depositi_periodo
Rendimento % = (P/L / giacenza_media_periodo) * 100
```

**Selezione valore in base a viewMode**:
- `base`: usa `total_value`
- `netting_total`: usa `netting_total`
- `netting_ex_cc`: usa `netting_ex_cc`
- `netting_ex_cc_np`: usa `netting_ex_cc_np` (fallback a `netting_ex_cc`)

---

### Slide 2: Rendimento per Anno (BarChart)

**Dati da mostrare**:
- Asse X: anni (2023, 2024, 2025, ecc.)
- Asse Y: Rendimento % annuale

**Calcolo**:
Per ogni anno con dati:
1. Trova il primo e ultimo snapshot dell'anno
2. Calcola rendimento % dall'inizio alla fine dell'anno
3. Colori: verde per rendimento positivo, rosso per negativo

---

### Slide 3: Evoluzione Patrimonio (LineChart)

**Dati da mostrare**:
- Asse X: date degli snapshot
- Asse Y: valore patrimoniale

**Caratteristiche**:
- Linea continua con area fill sfumata
- Punto evidenziato per il valore corrente (se disponibile)
- Tooltip con data e valore formattato

---

## Modifiche ai File Esistenti

### `Dashboard.tsx`

Aggiungere il nuovo carousel sotto `DynamicPortfolioChart`:

```tsx
// Dopo DynamicPortfolioChart
<HistoricalChartsCarousel
  historicalData={historicalData}
  viewMode={viewMode}
  currentValue={
    viewMode === 'base' ? summary?.totalValue ?? 0
    : viewMode === 'netting_total' ? netting.nettingTotal
    : viewMode === 'netting_ex_cc' ? netting.nettingExCoveredCall
    : netting.nettingExCCAndNP
  }
  currentDate={portfolio?.snapshot_date}
  deposits={deposits}
/>
```

---

## Nuovi File da Creare

| File | Descrizione |
|------|-------------|
| `src/components/dashboard/HistoricalChartsCarousel.tsx` | Container carousel con navigazione |
| `src/components/dashboard/charts/PerformanceEvolutionChart.tsx` | Grafico evoluzione rendimento % e P/L |
| `src/components/dashboard/charts/YearlyReturnChart.tsx` | Istogramma rendimento annuale |
| `src/components/dashboard/charts/PortfolioEvolutionChart.tsx` | Grafico evoluzione patrimonio |

---

## Design UI

- I grafici usano la palette colori esistente (`hsl(var(--primary))`, `hsl(var(--profit))`, `hsl(var(--loss))`)
- Altezza carousel: circa 300px
- Responsive: su mobile i grafici si adattano alla larghezza
- Navigazione carousel: frecce laterali + pallini indicatori (come ViewModeSelector)
- Card con bordo sottile e sfondo `bg-card`

---

## Gestione Casi Limite

| Caso | Comportamento |
|------|---------------|
| Nessun dato storico | Mostra messaggio "Nessun dato storico disponibile. Salva degli snapshot per visualizzare i grafici." |
| Solo 1 snapshot | Mostra solo Slide 3 (patrimonio) con un punto singolo |
| Dati incompleti (es. `netting_ex_cc_np` null) | Fallback al campo `netting_ex_cc` |

---

## Librerie Utilizzate

- **Recharts**: gia presente nel progetto per i grafici esistenti (`LineChart`, `BarChart`, `Area`, `Tooltip`, `ResponsiveContainer`)
- **Embla Carousel**: gia presente tramite il componente `Carousel` di shadcn/ui
- **date-fns**: gia presente per la formattazione date

---

## Risultato Atteso

1. Sotto il grafico principale appare un carousel navigabile
2. Slide 1 mostra l'evoluzione del rendimento % con linea e opzionalmente il P/L assoluto
3. Slide 2 mostra un istogramma con il rendimento di ogni anno (colorato verde/rosso)
4. Slide 3 mostra l'andamento del patrimonio nel tempo
5. Tutti i grafici si aggiornano automaticamente quando si cambia viewMode
6. I dati storici sono ordinati cronologicamente (dal piu vecchio al piu recente)

