import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSliderCommit } from '@/hooks/useSliderCommit';
import { useStressLabCharts } from '@/hooks/useStressLabCharts';
import type { StressLabChartInput, StressLabChartResult } from '@/lib/stressLabCharts';

function SliderFixture({ save, commit }: { save: (n: number) => void; commit: (n: number) => void }) {
  const [value, setValue] = useState(2);
  const { local, inputProps } = useSliderCommit(value, (n) => { commit(n); setValue(n); }, true);
  return <><input aria-label="Rolling" type="range" min={0} max={10} value={local} {...inputProps} />
    <button onClick={() => save(value)}>Salva</button><button onClick={() => setValue(1)}>Reset</button></>;
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: { data: { result: StressLabChartResult } }) => void;
  onerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
}
const chart = { curve: [], marCurve: [], heat: null, ruinX: null, marginCallX: null, curveMin: -35 } satisfies StressLabChartResult;

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); FakeWorker.instances = []; });

describe('rolling slider commits', () => {
  it('keeps drag local, commits once on release and saves the final value', () => {
    const commit = vi.fn(), save = vi.fn();
    render(<SliderFixture save={save} commit={commit} />);
    const slider = screen.getByRole('slider');
    fireEvent.pointerDown(slider);
    for (let value = 3; value <= 8; value++) fireEvent.change(slider, { target: { value } });
    expect(commit).not.toHaveBeenCalled();
    expect(slider).toHaveValue('8');
    fireEvent.pointerUp(slider); fireEvent.lostPointerCapture(slider); fireEvent.blur(slider);
    expect(commit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Salva'));
    expect(save).toHaveBeenCalledWith(8);
  });
  it('commits keyboard repeat on keyup and a pending edit on blur before Save', () => {
    const commit = vi.fn(), save = vi.fn();
    render(<SliderFixture save={save} commit={commit} />);
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.change(slider, { target: { value: 4 } });
    fireEvent.change(slider, { target: { value: 6 } });
    expect(commit).not.toHaveBeenCalled();
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    expect(commit).toHaveBeenCalledWith(6);
    fireEvent.pointerDown(slider); fireEvent.change(slider, { target: { value: 9 } });
    fireEvent.blur(slider); fireEvent.click(screen.getByText('Salva'));
    expect(save).toHaveBeenCalledWith(9);
  });
  it('discards cancelled or externally reset edits; supports assistive input', () => {
    const commit = vi.fn();
    render(<SliderFixture save={vi.fn()} commit={commit} />);
    const slider = screen.getByRole('slider');
    fireEvent.pointerDown(slider); fireEvent.change(slider, { target: { value: 8 } });
    fireEvent.pointerCancel(slider); fireEvent.lostPointerCapture(slider);
    expect(slider).toHaveValue('2'); expect(commit).not.toHaveBeenCalled();
    fireEvent.pointerDown(slider); fireEvent.change(slider, { target: { value: 7 } });
    fireEvent.click(screen.getByText('Reset')); fireEvent.pointerUp(slider);
    expect(slider).toHaveValue('1'); expect(commit).not.toHaveBeenCalled();
    fireEvent.change(slider, { target: { value: 5 } });
    expect(commit).toHaveBeenCalledWith(5);
  });
});

describe('background chart lifecycle', () => {
  const setup = () => { vi.useFakeTimers(); vi.stubGlobal('Worker', FakeWorker); };
  const tick = () => act(() => vi.advanceTimersByTime(120));
  it('coalesces edits, terminates obsolete work, and ignores late replies', () => {
    setup();
    const first = {} as StressLabChartInput, second = {} as StressLabChartInput, third = {} as StressLabChartInput;
    const { result, rerender, unmount } = renderHook(({ input }) => useStressLabCharts(input, 'A'), { initialProps: { input: first } });
    rerender({ input: second }); tick();
    expect(FakeWorker.instances).toHaveLength(1);
    const old = FakeWorker.instances[0]; expect(old.postMessage).toHaveBeenCalledWith(second);
    rerender({ input: third }); expect(old.terminate).toHaveBeenCalled(); tick();
    act(() => old.onmessage?.({ data: { result: chart } }));
    expect(result.current.isPending).toBe(true); expect(result.current.result).toBeUndefined();
    act(() => FakeWorker.instances[1].onmessage?.({ data: { result: chart } }));
    expect(result.current.result).toEqual(chart); expect(result.current.isPending).toBe(false);
    unmount(); expect(FakeWorker.instances[1].terminate).toHaveBeenCalled();
  });
  it('retains prior charts only within the same portfolio and handles retry', () => {
    setup(); const input = {} as StressLabChartInput;
    const { result, rerender } = renderHook(({ scope, input }) => useStressLabCharts(input, scope), { initialProps: { scope: 'A', input } });
    tick(); act(() => FakeWorker.instances[0].onmessage?.({ data: { result: chart } }));
    rerender({ scope: 'A', input: { ...input } }); expect(result.current.result).toEqual(chart); expect(result.current.isPending).toBe(true);
    rerender({ scope: 'B', input }); expect(result.current.result).toBeUndefined(); tick();
    act(() => FakeWorker.instances[1].onerror?.());
    expect(result.current.error).toBeTruthy(); expect(result.current.isPending).toBe(false);
    act(() => result.current.retry()); tick();
    act(() => FakeWorker.instances[2].onmessage?.({ data: { result: chart } }));
    expect(result.current.error).toBeUndefined(); expect(result.current.result).toEqual(chart);
  });
});
