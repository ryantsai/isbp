import { type RefObject, useEffect } from 'react';

/**
 * Astryx inputs (`TextInput`, `TextArea`, `Typeahead`, `Tokenizer`…) generate their own input `id`, name it with their own
 * (hidden) label and wire their own `aria-describedby`: a caller's `id` / `aria-label` / `aria-describedby` never reach
 * the `<input>`. Composites whose callers still tie an external `<label htmlFor>` or an error text to the control
 * (`PersonPicker`, `RecordPicker`, `LocalizedInput`, `FieldControl`) call this with the element the Astryx field renders
 * into, and it restores the native semantics: the caller's `id` goes on the real input (the field's own hidden label is
 * only kept as its name when no external label points at that `id`), `aria-label` wins as before, and the caller's
 * description ids are appended.
 *
 * `deps` re-runs it when the input is re-created (e.g. a `Tokenizer` hides its input at the entry limit).
 */
export function useInputAttrs(
  root: RefObject<HTMLElement | null>,
  {
    id,
    describedBy,
    label,
  }: { id?: string | undefined; describedBy?: string | undefined; label?: string | undefined },
  deps: readonly unknown[] = [],
) {
  useEffect(() => {
    const host = root.current;
    const el = host?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, [role="combobox"]');
    if (!host || !el || (!id && !describedBy && !label)) return;
    const original = el.id;
    const own = Array.from(host.querySelectorAll<HTMLLabelElement>('label')).filter(
      (l) => l.htmlFor === original,
    );
    const hadLabel = el.getAttribute('aria-label');
    const hadDescribedBy = el.getAttribute('aria-describedby');
    if (id) {
      el.id = id;
      const external = Array.from(document.querySelectorAll<HTMLLabelElement>('label')).some(
        (l) => l.htmlFor === id && !host.contains(l),
      );
      if (!external) own.forEach((l) => (l.htmlFor = id));
    }
    if (label) el.setAttribute('aria-label', label);
    if (describedBy)
      el.setAttribute('aria-describedby', [hadDescribedBy, describedBy].filter(Boolean).join(' '));
    return () => {
      if (id) {
        el.id = original;
        own.forEach((l) => (l.htmlFor = original));
      }
      if (label) {
        if (hadLabel) el.setAttribute('aria-label', hadLabel);
        else el.removeAttribute('aria-label');
      }
      if (describedBy) {
        if (hadDescribedBy) el.setAttribute('aria-describedby', hadDescribedBy);
        else el.removeAttribute('aria-describedby');
      }
    };
    // `root` is a ref object; the caller controls re-runs through `deps`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, describedBy, label, ...deps]);
}
