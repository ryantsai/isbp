import type { AssignFormTaskConfig } from '@isbp/contracts';
import type { TaskTypeHandler } from '@isbp/sdk/server';
import { FormAssignmentService } from './services/form-assignments';

/**
 * `core.assign-form` ("Assign a form"): each run opens the assignment of the period its slot falls in, in the job's
 * time zone — "1st of every month 09:00 Asia/Taipei" opens the monthly server room inspection. Idempotent per form,
 * assignee and period, so retries and "Run now" never open a second one.
 */
export const assignFormTask: TaskTypeHandler<AssignFormTaskConfig> = {
  validate: async (config, ctx) => new FormAssignmentService(ctx).validateTask(config),
  describe: async (config, ctx) => new FormAssignmentService(ctx).describeTask(config),
  run: async (config, task, ctx) => new FormAssignmentService(ctx).runTask(config, task),
};

export const taskTypes = { 'assign-form': assignFormTask };
