import type { ModuleContext } from '@isbp/sdk/server';
import { CallService } from './calls';
import { EndpointService } from './endpoints';
import { PipelineService } from './pipelines';

export interface EtlServices {
  endpoints: EndpointService;
  calls: CallService;
  pipelines: PipelineService;
}

const cache = new WeakMap<ModuleContext, EtlServices>();

/**
 * The module's service layer: routes, the invocation route, AI tools, record resolvers, the task type, jobs,
 * event handlers and the seed all call these, so the rules live in one place. Stateless; one set per context.
 */
export function services(ctx: ModuleContext): EtlServices {
  let s = cache.get(ctx);
  if (!s) {
    s = {
      endpoints: new EndpointService(ctx),
      calls: new CallService(ctx),
      pipelines: new PipelineService(ctx),
    };
    cache.set(ctx, s);
  }
  return s;
}
