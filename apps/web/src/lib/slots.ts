import type { SlotContribution, SlotRegistry, WebSlot } from '@isbp/sdk/web';
import { lazy } from 'react';
import { webModules } from '@/generated/modules';

/**
 * Core's and every installed module's slot contributions, with lazy components created once at import time (the
 * React Compiler forbids creating components during render). `<Slot>` filters by enabled module and
 * permission at render time.
 */
/** Panels the platform itself contributes: any module's record page can host them. */
const CORE_SLOTS: { slot: string; load: WebSlot['load']; permission?: string }[] = [
  { slot: 'core.record.links', load: () => import('@/components/records/linked-records') },
  { slot: 'core.record.files', load: () => import('@/components/records/record-files') },
  // Previews of core customisation kinds on the assistant's change set page (`assistant.preview.<module>.<kind>`).
  { slot: 'assistant.preview.core.workflow', load: () => import('@/components/workflows/change-preview') },
  { slot: 'assistant.preview.core.form', load: () => import('@/components/forms/change-preview') },
];

export const slotRegistry: SlotRegistry = (() => {
  const map = new Map<string, SlotContribution[]>();
  for (const s of CORE_SLOTS)
    map.set(s.slot, [{ moduleId: 'core', Component: lazy(s.load), permission: s.permission, order: 0 }]);
  for (const [moduleId, mod] of Object.entries(webModules)) {
    for (const s of mod.slots) {
      const list = map.get(s.slot) ?? [];
      list.push({ moduleId, Component: lazy(s.load), permission: s.permission, order: s.order ?? 100 });
      map.set(s.slot, list);
    }
  }
  for (const list of map.values())
    list.sort((a, b) => a.order - b.order || a.moduleId.localeCompare(b.moduleId));
  return map;
})();
