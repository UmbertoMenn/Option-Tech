

## Mostrare il Gain Potenziale Netto Totale per Iron Condor

### Problema

Attualmente la calcolatrice e la riga Iron Condor mostrano il **gain potenziale lordo** (`grossPremium` = valore assoluto, senza commissioni). Il valore corretto da mostrare e' il **gain potenziale netto totale** (`netPremium` = lordo - commissioni), cioe' 4.220 USD nell'esempio.

### Modifiche

**1. `src/components/derivatives/CallPremiumCalculatorDialog.tsx`**

- Valore principale per Iron Condor: cambiare da `metrics.grossPremium` a `metrics.netPremium`
- Label: "Gain Potenziale" (invariata)
- Salvataggio: cambiare `net_per_share: metrics.grossPremium` in `net_per_share: metrics.netPremium`

**2. `src/pages/Derivatives.tsx`**

Nessuna modifica necessaria: la riga gia' legge `savedPremium.net_per_share`, che ora conterra' il valore netto corretto.

### Riepilogo

| Dove | Prima | Dopo |
|---|---|---|
| Calcolatrice (valore grande) | `grossPremium` (lordo) | `netPremium` (netto commissioni) |
| Salvataggio DB | `grossPremium` | `netPremium` |
| Riga IC (GP) | Legge `net_per_share` (invariato) | Legge `net_per_share` (invariato) |

