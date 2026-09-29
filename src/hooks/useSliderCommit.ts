import { useEffect, useRef, useState, useTransition } from 'react';
import type { ChangeEvent, KeyboardEvent, PointerEvent } from 'react';

const rangeKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/** Keep dragging local; expensive calculations receive only the final value. */
export function useSliderCommit(value: number, set: (value: number) => void, onRelease = false) {
  const [local, setLocal] = useState(value);
  const pending = useRef<number | null>(null);
  const pointerActive = useRef(false);
  const keyboardActive = useRef(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    // External reset / saved configuration replaces any unfinished edit.
    pending.current = null;
    setLocal(value);
  }, [value]);

  const commit = () => {
    const next = pending.current;
    pending.current = null;
    // A discrete update is intentional: clicking Save after blur must save this
    // value, not the previous one waiting in a React transition.
    if (next !== null && next !== value) set(next);
  };

  return {
    local,
    inputProps: {
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const next = Number(event.currentTarget.value);
        setLocal(next);
        if (!onRelease) {
          startTransition(() => set(next));
          return;
        }
        pending.current = next;
        // Assistive technology can change a range without pointer/key events.
        if (!pointerActive.current && !keyboardActive.current) commit();
      },
      onPointerDown: (event: PointerEvent<HTMLInputElement>) => {
        if (!onRelease) return;
        pointerActive.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
      },
      onPointerUp: () => {
        pointerActive.current = false;
        commit();
      },
      onLostPointerCapture: () => {
        pointerActive.current = false;
        commit();
      },
      onPointerCancel: () => {
        pointerActive.current = false;
        pending.current = null;
        setLocal(value);
      },
      onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
        if (onRelease && rangeKeys.has(event.key)) keyboardActive.current = true;
      },
      onKeyUp: (event: KeyboardEvent<HTMLInputElement>) => {
        if (!rangeKeys.has(event.key)) return;
        keyboardActive.current = false;
        commit();
      },
      onBlur: () => {
        pointerActive.current = false;
        keyboardActive.current = false;
        commit();
      },
    },
  };
}
