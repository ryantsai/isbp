/*
 * Form categories are plain text on the form (`category`). The portal groups forms by it and translates the known
 * keys (`requests.categories.<key>`: hardware, software, …); any other category shows as typed, in every language.
 * Builders offer the categories in use once each, so "Hardware" and "hardware " stay one category.
 */

/** How two spellings of a category compare: trimmed, case-insensitive, inner spaces collapsed. */
export function categoryMatchKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

/**
 * The category to store for what someone typed or picked: a known key when it matches one (any case: "Hardware" →
 * `hardware`, so the portal translates it), otherwise the text, trimmed. Empty → null.
 */
export function canonicalCategory(
  value: string | null | undefined,
  knownKeys: readonly string[],
): string | null {
  const text = (value ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const match = categoryMatchKey(text);
  return knownKeys.find((k) => categoryMatchKey(k) === match) ?? text;
}

/**
 * The categories in use, once each and in first-seen order: spellings that differ only in case or spaces are one
 * category. A known key stands for itself; otherwise the most used spelling wins (the first on a tie).
 */
export function categoryChoices(
  values: readonly (string | null | undefined)[],
  knownKeys: readonly string[],
): string[] {
  const groups = new Map<string, Map<string, number>>();
  for (const raw of values) {
    const value = canonicalCategory(raw, knownKeys);
    if (!value) continue;
    const key = categoryMatchKey(value);
    const spellings = groups.get(key) ?? new Map<string, number>();
    spellings.set(value, (spellings.get(value) ?? 0) + 1);
    groups.set(key, spellings);
  }
  return [...groups.values()].map((spellings) => {
    let best = '';
    let most = 0;
    for (const [spelling, n] of spellings)
      if (n > most) {
        best = spelling;
        most = n;
      }
    return best;
  });
}
