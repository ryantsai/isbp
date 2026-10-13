import type { ModuleContext } from '@isbp/sdk/server';
import { ActionItemService } from './action-items';
import { MeetingService } from './meetings';

export interface Services {
  meetings: MeetingService;
  items: ActionItemService;
}

const cache = new WeakMap<ModuleContext, Services>();

/** Routes, the record resolver, AI tools, event handlers, jobs and the seed all call these, so the rules hold for all. */
export function services(ctx: ModuleContext): Services {
  let s = cache.get(ctx);
  if (!s) {
    const items = new ActionItemService(ctx);
    s = { items, meetings: new MeetingService(ctx, items) };
    cache.set(ctx, s);
  }
  return s;
}
