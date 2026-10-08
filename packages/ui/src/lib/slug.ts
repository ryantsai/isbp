/**
 * Heading anchors, as GitHub makes them, so `#section` links in Markdown work the same in the repository and in the
 * app (`Markdown anchors`). The user guide's generator and tests use the same rules (`pnpm docs:guide`).
 */

/** `Raise a ticket` → `raise-a-ticket`; letters of every script are kept (`建立工單` → `建立工單`). */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Anchors for one document's headings, in order: a repeated heading gets `-1`, `-2`… */
export function createSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = headingSlug(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  };
}
