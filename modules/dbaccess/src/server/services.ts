import type { ModuleContext } from '@isbp/sdk/server';
import { GrantService } from './grants';
import { RequestService } from './requests';
import { ReviewService } from './reviews';
import { ServerService } from './servers';

export interface DbaccessServices {
  servers: ServerService;
  grants: GrantService;
  requests: RequestService;
  reviews: ReviewService;
}

const cache = new WeakMap<ModuleContext, DbaccessServices>();

/**
 * The module's service layer: routes, AI tools, jobs, the task type, event handlers and the seed all call
 * these, so the rules live in one place. Stateless; one set per context.
 */
export function services(ctx: ModuleContext): DbaccessServices {
  let s = cache.get(ctx);
  if (!s) {
    const servers = new ServerService(ctx);
    const grants = new GrantService(ctx, servers);
    s = {
      servers,
      grants,
      requests: new RequestService(ctx, servers, grants),
      reviews: new ReviewService(ctx, servers, grants),
    };
    cache.set(ctx, s);
  }
  return s;
}
