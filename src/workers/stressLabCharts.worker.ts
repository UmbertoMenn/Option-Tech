import { computeStressLabCharts } from '../lib/stressLabCharts';
import type { StressLabChartInput } from '../lib/stressLabCharts';

self.onmessage = (event: MessageEvent<StressLabChartInput>) => {
  try {
    self.postMessage({ result: computeStressLabCharts(event.data) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Calcolo non riuscito' });
  }
};
