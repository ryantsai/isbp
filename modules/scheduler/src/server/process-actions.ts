/**
 * `scheduler.run-job`: a request form runs a chosen job now (e.g. "refresh the report after approval"). The run is
 * requested like "Run now" by someone allowed to run the job; its page is the action's result.
 */
import {
  ErrorCodes,
  type FieldDef,
  HttpError,
  type LocalizedText,
  type ProcessActionHandler,
} from '@isbp/sdk/server';
import en from '../../messages/en.json';
import ja from '../../messages/ja-JP.json';
import zh from '../../messages/zh-TW.json';
import { runHref } from '../model';
import { services } from './services';

const label = (pick: (c: typeof en) => string): LocalizedText => ({
  en: pick(en),
  'zh-TW': pick(zh as typeof en),
  'ja-JP': pick(ja as typeof en),
});

export const runJobAction: ProcessActionHandler = {
  async fields(ctx) {
    const jobs = await services(ctx).jobs.options(undefined, 200);
    return [
      {
        key: 'jobId',
        type: 'select',
        label: label((c) => c.processActions.runJob.job),
        help: label((c) => c.processActions.runJob.jobHelp),
        required: true,
        options: jobs.map((j) => ({ value: j.id, label: { en: j.name } })),
      },
    ] satisfies FieldDef[];
  },

  async run({ config, auth }, ctx) {
    const s = services(ctx);
    const job = await s.jobs.row(String(config.jobId));
    try {
      const run = await s.jobs.run(job.id, auth);
      return {
        reference: job.name,
        href: runHref(run.id),
        summary: 'scheduler.processActions.runJob.started',
      };
    } catch (err) {
      // A job that only runs one at a time is busy: try again later rather than give up.
      if (err instanceof HttpError && err.code === ErrorCodes.JOB_RUNNING)
        throw new Error(`${job.name} is already running`);
      throw err;
    }
  },
};

export const processActions = { 'run-job': runJobAction };
