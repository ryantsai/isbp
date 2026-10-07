import type { ModuleContext } from '@isbp/sdk/server';
import { ProjectService } from './projects';
import { TaskService } from './tasks';
import { WorkloadService } from './workload';

export interface Services {
  projects: ProjectService;
  tasks: TaskService;
  workload: WorkloadService;
}

const cache = new WeakMap<ModuleContext, Services>();

/**
 * The module's write logic lives in these services. Routes, AI tools, event handlers, jobs and a future
 * Azure DevOps sync adapter all call them, so the rules hold for any principal.
 */
export function services(ctx: ModuleContext): Services {
  let s = cache.get(ctx);
  if (!s) {
    const projects = new ProjectService(ctx);
    s = { projects, tasks: new TaskService(ctx, projects), workload: new WorkloadService(ctx, projects) };
    cache.set(ctx, s);
  }
  return s;
}
