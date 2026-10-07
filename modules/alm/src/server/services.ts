import type { ModuleContext } from '@isbp/sdk/server';
import { ApplicationService } from './applications';
import { DeploymentService } from './deployments';
import { MetricsService } from './metrics';
import { ReleaseService } from './releases';

export interface AlmServices {
  apps: ApplicationService;
  releases: ReleaseService;
  deployments: DeploymentService;
  metrics: MetricsService;
}

const cache = new WeakMap<ModuleContext, AlmServices>();

/**
 * The module's service layer: routes, AI tools, record resolvers, event handlers, the seed and (in Phase 5)
 * sync adapters all call these, so business rules live in one place. Stateless; one set per context.
 */
export function services(ctx: ModuleContext): AlmServices {
  let s = cache.get(ctx);
  if (!s) {
    const apps = new ApplicationService(ctx);
    const releases = new ReleaseService(ctx, apps);
    s = {
      apps,
      releases,
      deployments: new DeploymentService(ctx, apps, releases),
      metrics: new MetricsService(ctx, apps, releases),
    };
    cache.set(ctx, s);
  }
  return s;
}
