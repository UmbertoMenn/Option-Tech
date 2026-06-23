## Obiettivo
Sostituire il colore attuale (arancio / `text-warning`) dei titoli attivi nei selettori di vista — sia in Dashboard che in Risk Analyzer — con il rosso corallo scelto dall'utente.

## File da modificare
1. `src/components/dashboard/ViewModeSelector.tsx`
2. `src/components/risk/RiskViewModeSelector.tsx`

## Modifica tecnica
Nei due componenti, nel pulsante/tab attivo, sostituire `text-warning` con una classe Tailwind che corrisponda al rosso corallo (es. `text-red-400` o un token semantico equivalente). Se il design system non ha già un token per il corallo, si aggiunge una classe inline `text-[#f87171]` o si estende il tema.

## Accettazione
- I titoli delle viste attive in Dashboard e Risk Analyzer devono apparire in rosso corallo chiaro (#f87171 o equivalente Tailwind).
- Il colore precedente (arancio) non deve più essere visibile.
- Nessun altro elemento dell'UI deve essere alterato.