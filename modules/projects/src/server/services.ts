import type { ModuleContext } from '@isbp/sdk/server';
import { ProjectService } from './projects';
import { ReportTemplateService } from './report-templates';
import { ReportingService } from './reporting';
import { StatusReportService } from './status-report';
import { StatusUpdateService } from './status-updates';
import { TaskService } from './tasks';
import { WorkloadService } from './workload';

export interface Services {
  projects: ProjectService;
  tasks: TaskService;
  workload: WorkloadService;
  /** Phase 11: the reporting schedule, status updates, report templates and the status report. */
  reporting: ReportingService;
  statusUpdates: StatusUpdateService;
  templates: ReportTemplateService;
  reports: StatusReportService;
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
    const reporting = new ReportingService(ctx);
    const templates = new ReportTemplateService(ctx);
    s = {
      projects,
      tasks: new TaskService(ctx, projects),
      workload: new WorkloadService(ctx, projects),
      reporting,
      statusUpdates: new StatusUpdateService(ctx, projects, reporting),
      templates,
      reports: new StatusReportService(ctx, reporting, templates),
    };
    cache.set(ctx, s);
  }
  return s;
}
