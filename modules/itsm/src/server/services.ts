import type { ModuleContext } from '@isbp/sdk/server';
import { ChangeCalendar } from './changes';
import { ConfigService } from './config';
import { FulfilmentService } from './fulfilment';
import { TicketService } from './tickets';

export interface Services {
  tickets: TicketService;
  config: ConfigService;
  calendar: ChangeCalendar;
  fulfilment: FulfilmentService;
}

const cache = new WeakMap<ModuleContext, Services>();

/** One set of services per module context (routes, tools, events and jobs share them). */
export function services(ctx: ModuleContext): Services {
  let s = cache.get(ctx);
  if (!s) {
    const tickets = new TicketService(ctx);
    s = {
      tickets,
      config: new ConfigService(ctx),
      calendar: new ChangeCalendar(ctx, tickets.reader),
      fulfilment: new FulfilmentService(ctx, tickets),
    };
    cache.set(ctx, s);
  }
  return s;
}
