import {
  aiConfigSchema,
  aiIndexInfoSchema,
  aiStatusSchema,
  aiTestResultSchema,
  aiUsageQuerySchema,
  aiUsageReportSchema,
  okSchema,
  updateAiConfigSchema,
} from '@isbp/contracts';
import type { ModuleRouter } from '@isbp/sdk/server';
import { getKernel } from '../kernel-ref';
import type { AiAdminService } from '../services/ai';

const MANAGE = 'core.ai.manage';

/** The AI gateway's admin surface (Administration → AI) and its public status. */
export function aiRoutes(app: ModuleRouter, svc: AiAdminService) {
  const tags = ['AI'];

  app.get(
    '/ai/status',
    {
      schema: {
        tags,
        summary: 'Whether a generative model is configured (features show their mode from this)',
        response: { 200: aiStatusSchema },
      },
    },
    async () => getKernel().ai.status(),
  );

  app.get(
    '/ai/config',
    {
      config: { permission: MANAGE },
      schema: {
        tags,
        summary: 'AI providers, privacy and budget (secrets omitted)',
        response: { 200: aiConfigSchema },
      },
    },
    async () => svc.config(),
  );

  app.put(
    '/ai/config',
    {
      config: { permission: MANAGE },
      schema: {
        tags,
        summary: 'Change AI providers, privacy and budget',
        body: updateAiConfigSchema,
        response: { 200: aiConfigSchema },
      },
    },
    async (req) => svc.update(req.body, req.auth),
  );

  app.post(
    '/ai/test',
    {
      config: { permission: MANAGE },
      schema: {
        tags,
        summary: 'Send a tiny request to the configured chat and embedding models',
        response: { 200: aiTestResultSchema },
      },
    },
    async () => getKernel().ai.test(),
  );

  app.get(
    '/ai/usage',
    {
      config: { permission: MANAGE },
      schema: {
        tags,
        summary: 'AI calls, tokens and cost by feature and model',
        querystring: aiUsageQuerySchema,
        response: { 200: aiUsageReportSchema },
      },
    },
    async (req) => svc.usage(req.query.days),
  );

  app.get(
    '/ai/index',
    {
      config: { permission: MANAGE },
      schema: { tags, summary: 'Semantic index status', response: { 200: aiIndexInfoSchema } },
    },
    async () => svc.index(),
  );

  app.post(
    '/ai/index/attachments/retry',
    {
      config: { permission: MANAGE },
      schema: {
        tags,
        summary: 'Read again the attachments that are not searchable yet (failed, scans, unsupported types)',
        response: { 200: okSchema },
      },
    },
    async (req) => svc.retryAttachments(req.auth),
  );

  app.post(
    '/ai/index/reindex',
    {
      config: { permission: MANAGE },
      schema: {
        tags,
        summary: 'Re-embed documents left on an older embedding model',
        response: { 200: okSchema },
      },
    },
    async (req) => svc.reindex(req.auth),
  );
}
