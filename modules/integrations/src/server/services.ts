import type { ModuleContext } from '@isbp/sdk/server';
import { ConflictService } from './conflicts';
import { ConnectionService } from './connections';
import { Engine } from './engine';
import { LinkService } from './links';
import { ProfileService } from './profiles';
import { RunService } from './runs';

/** One bundle per context: routes, jobs, handlers, the task type and the seed helpers share the same rules. */
export interface HubServices {
  connections: ConnectionService;
  profiles: ProfileService;
  runs: RunService;
  links: LinkService;
  conflicts: ConflictService;
  engine: Engine;
}

const cache = new WeakMap<ModuleContext, HubServices>();

export function services(ctx: ModuleContext): HubServices {
  let s = cache.get(ctx);
  if (!s) {
    const connections = new ConnectionService(ctx);
    const runs = new RunService(ctx);
    const engine = new Engine(ctx, { connections, runs });
    s = {
      connections,
      runs,
      engine,
      profiles: new ProfileService(ctx, { connections, runs }),
      links: new LinkService(ctx, { connections, engine: () => engine }),
      conflicts: new ConflictService(ctx, { connections }),
    };
    cache.set(ctx, s);
  }
  return s;
}
