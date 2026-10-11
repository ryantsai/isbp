import { type RefObject, useEffect } from 'react';

/**
 * Names the real `<input>` an Astryx field renders by the element the caller points at (`aria-labelledby`): Astryx
 * inputs draw their own hidden label and never forward the caller's `aria-labelledby` to the control. The hidden label
 * stays as the fallback when no id is given.
 */
export function useLabelledBy(root: RefObject<HTMLElement | null>, labelledBy: string | undefined) {
  useEffect(() => {
    const el = root.current?.querySelector<HTMLElement>('input:not([type="hidden"]), [role="combobox"]');
    if (!el || !labelledBy) return;
    const had = el.getAttribute('aria-labelledby');
    el.setAttribute('aria-labelledby', labelledBy);
    return () => {
      if (had) el.setAttribute('aria-labelledby', had);
      else el.removeAttribute('aria-labelledby');
    };
    // `root` is a ref object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelledBy]);
}
