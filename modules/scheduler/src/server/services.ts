import type { ModuleContext } from '@isbp/sdk/server';
import { DashboardService } from './dashboard';
import { Engine } from './engine';
import { JobService } from './jobs';
import { RunService } from './runs';

export interface SchedulerServices {
  engine: Engine;
  jobs: JobService;
  runs: RunService;
  dashboard: DashboardService;
}

const cache = new WeakMap<ModuleContext, SchedulerServices>();

/**
 * The module's service layer: routes, jobs, AI tools, record resolvers and the seed call these, so the
 * rules live in one place. Stateless; one set per module context.
 */
export function services(ctx: ModuleContext): SchedulerServices {
  let s = cache.get(ctx);
  if (!s) {
    const engine = new Engine(ctx);
    const jobs = new JobService(ctx, engine);
    s = { engine, jobs, runs: new RunService(ctx, engine, jobs), dashboard: new DashboardService(ctx) };
    cache.set(ctx, s);
  }
  return s;
}
