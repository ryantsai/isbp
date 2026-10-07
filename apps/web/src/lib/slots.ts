import type { SlotContribution, SlotRegistry } from '@isbp/sdk/web';
import { lazy } from 'react';
import { webModules } from '@/generated/modules';

/**
 * Every installed module's slot contributions, with lazy components created once at import time (the
 * React Compiler forbids creating components during render). `<Slot>` filters by enabled module and
 * permission at render time.
 */
export const slotRegistry: SlotRegistry = (() => {
  const map = new Map<string, SlotContribution[]>();
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
