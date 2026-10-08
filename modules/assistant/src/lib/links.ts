import type { ObjectLink, ObjectSnapshot } from '../contracts';

/** A page where people use an object an applied change set made or changed ("Open the form"). */
export interface AppliedLink {
  /** The change set item. */
  itemId: string;
  /** The object's name ("Configuration change request"). */
  object: string;
  href: string;
  /** What the link opens, per locale. */
  label: ObjectLink['label'];
}

/**
 * The links of the objects as an applied change set left them (each item's `after` snapshot), in item order and
 * without duplicates; archived objects have none.
 */
export function appliedLinks(
  items: readonly { id: string; label: string; after: ObjectSnapshot | null }[],
): AppliedLink[] {
  const seen = new Set<string>();
  const out: AppliedLink[] = [];
  for (const item of items) {
    const after = item.after;
    if (!after || after.archived) continue;
    for (const link of after.links ?? []) {
      if (seen.has(link.href)) continue;
      seen.add(link.href);
      out.push({ itemId: item.id, object: after.label || item.label, href: link.href, label: link.label });
    }
  }
  return out;
}

/** A link label in a locale (English, then any filled one). */
export function linkText(label: ObjectLink['label'], locale: string): string {
  return label[locale as keyof ObjectLink['label']] || label.en || label['zh-TW'] || label['ja-JP'] || '';
}
