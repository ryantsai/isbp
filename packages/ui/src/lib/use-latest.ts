import { useEffect, useMemo, useRef } from 'react';

/**
 * The newest value, readable from handlers that were created by an older render. Astryx inputs commit when they are
 * left (a number on blur), which can land after another change and before the next render; a handler that closes over
 * the render's `value` would then undo that change. `get()` is what the last render (or the last `set`) holds; `set`
 * records a change at once, before React has re-rendered with it.
 */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return useMemo(
    () => ({
      get: () => ref.current,
      set: (next: T) => {
        ref.current = next;
      },
    }),
    [],
  );
}
