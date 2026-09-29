import { useEffect, useState } from 'react';
import type { StressLabChartInput, StressLabChartResult } from '@/lib/stressLabCharts';

type State = { input: StressLabChartInput; scope: string; result?: StressLabChartResult; error?: string };

export function useStressLabCharts(input: StressLabChartInput, scope: string) {
  const [state, setState] = useState<State | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    let worker: Worker | null = null;
    // Coalesce quick edits; terminate obsolete work instead of queuing it.
    const timer = setTimeout(() => {
      try {
        worker = new Worker(new URL('../workers/stressLabCharts.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<{ result?: StressLabChartResult; error?: string }>) => {
          if (active) setState({ input, scope, ...event.data });
          worker?.terminate();
        };
        const onError = () => {
          if (active) setState({ input, scope, error: 'Impossibile aggiornare i grafici. Riprova.' });
          worker?.terminate();
        };
        worker.onerror = onError;
        worker.onmessageerror = onError;
        worker.postMessage(input);
      } catch {
        if (active) setState({ input, scope, error: 'Impossibile aggiornare i grafici. Riprova.' });
        worker?.terminate();
      }
    }, 120);
    return () => {
      active = false;
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [input, scope, retryCount]);

  const current = state?.input === input && state.scope === scope;
  return {
    // Never show a different client's or historical snapshot's charts.
    result: state?.scope === scope ? state.result : undefined,
    isPending: !current,
    error: current ? state.error : undefined,
    retry: () => { setState(null); setRetryCount((n) => n + 1); },
  };
}
