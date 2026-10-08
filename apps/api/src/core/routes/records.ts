import {
  createRecordLinkSchema,
  fileInfoSchema,
  recordFilesResponseSchema,
  recordLinksResponseSchema,
  recordResolveQuerySchema,
  recordResolveResponseSchema,
  recordSearchQuerySchema,
  recordTypeSchema,
  resolvedRecordSchema,
} from '@isbp/contracts';
import {
  type AuthContext,
  ErrorCodes,
  evaluateCondition,
  type FactDef,
  factsFromJsonSchema,
  formatRecordRef,
  HttpError,
  httpErrors,
  type ModuleRouter,
  parseRecordRef,
  type RecordTypeDef,
} from '@isbp/sdk/server';
import { z } from 'zod';
import { contentDisposition } from '../../kernel/files/policy';
import { getKernel } from '../kernel-ref';

const recordParams = z.object({
  type: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/),
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
});

/** The record must exist and be visible to the caller (404 otherwise, so ids can't be probed). */
async function visible(auth: AuthContext, ref: { type: string; id: string }) {
  const record = await getKernel().records.get(ref, auth);
  if (!record) throw httpErrors.notFound('Record not found');
  return record;
}

async function editable(auth: AuthContext, ref: { type: string; id: string }) {
  const record = await visible(auth, ref);
  if (!record.editable) throw httpErrors.forbidden('You cannot change this record');
  return record;
}

const factCache = new WeakMap<RecordTypeDef, FactDef[]>();

/** A record type's approval facts as pickable paths (`criticality`, `ownerGroup`, …). */
export function recordTypeFacts(def: RecordTypeDef): FactDef[] {
  let facts = factCache.get(def);
  if (!facts) {
    try {
      facts = def.facts ? factsFromJsonSchema(z.toJSONSchema(def.facts, { unrepresentable: 'any' })) : [];
    } catch {
      facts = [];
    }
    factCache.set(def, facts);
  }
  return facts;
}

/**
 * Links between records of any modules and attachments on them. People only (no API clients): every
 * call is checked against the owning module's resolver for the caller.
 */
export function recordRoutes(app: ModuleRouter) {
  const tags = ['Records'];

  app.get(
    '/records/types',
    {
      schema: {
        tags,
        summary:
          'Record types you can link to or pick (enabled modules, your permissions), with their approval facts; `all=true` lists every enabled type (workflow builders)',
        querystring: z.object({ all: z.stringbool().default(false) }),
        response: { 200: z.object({ items: z.array(recordTypeSchema) }) },
      },
    },
    async (req) => {
      const kernel = getKernel();
      const types = req.query.all
        ? kernel.registry.enabledModules().flatMap((m) =>
            (m.manifest.records?.types ?? []).map((def) => ({
              type: `${m.manifest.id}.${def.type}`,
              moduleId: m.manifest.id,
              def,
            })),
          )
        : kernel.records.types(req.auth);
      return {
        items: types.map((t) => ({
          type: t.type,
          moduleId: t.moduleId,
          name: t.def.name,
          icon: t.def.icon ?? null,
          facts: recordTypeFacts(t.def),
        })),
      };
    },
  );

  app.get(
    '/records/search',
    {
      schema: {
        tags,
        summary:
          'Find records to link or pick: by reference or title (empty query: recent ones); `where` keeps those whose facts match',
        querystring: recordSearchQuerySchema,
        response: { 200: z.object({ items: z.array(resolvedRecordSchema) }) },
      },
    },
    async (req) => {
      const { q, types, limit, where } = req.query;
      const records = getKernel().records;
      if (!where) return { items: await records.search(q, { auth: req.auth, types, limit }) };
      // Only records the caller may already see are tested, so the filter reveals nothing new.
      const found = await records.search(q, { auth: req.auth, types, limit: 25 });
      const facts = await records.facts(found);
      return {
        items: found
          .filter((r) => evaluateCondition(where, facts.get(formatRecordRef(r)) ?? {}))
          .slice(0, limit),
      };
    },
  );

  app.get(
    '/records/resolve',
    {
      schema: {
        tags,
        summary:
          'Several records as the caller sees them (e.g. the values of a record field); others are counted as hidden',
        querystring: recordResolveQuerySchema,
        response: { 200: recordResolveResponseSchema },
      },
    },
    async (req) => {
      const refs = req.query.refs.map((r) => parseRecordRef(r)!).map(({ type, id }) => ({ type, id }));
      const found = await getKernel().records.resolve(refs, req.auth);
      const items = refs.flatMap((r) => found.get(formatRecordRef(r)) ?? []);
      return { items, hidden: refs.length - items.length };
    },
  );

  app.get(
    '/records/:type/:id',
    {
      schema: {
        tags,
        summary: 'One record as the caller sees it (reference, title, status, link)',
        params: recordParams,
        response: { 200: resolvedRecordSchema },
      },
    },
    async (req) => visible(req.auth, req.params),
  );

  app.get(
    '/records/:type/:id/links',
    {
      schema: {
        tags,
        summary: "A record's links; linked records you can't see are listed as hidden",
        params: recordParams,
        response: { 200: recordLinksResponseSchema },
      },
    },
    async (req) => {
      const record = await visible(req.auth, req.params);
      return { record, links: await getKernel().records.links(req.params, { auth: req.auth }) };
    },
  );

  app.post(
    '/records/:type/:id/links',
    {
      schema: {
        tags,
        summary: 'Link another record (you must be able to change this one and see the other)',
        params: recordParams,
        body: createRecordLinkSchema,
        response: { 201: z.object({ id: z.uuid(), created: z.boolean() }) },
      },
    },
    async (req, reply) => {
      await editable(req.auth, req.params);
      await visible(req.auth, req.body.to);
      const result = await getKernel().records.link(req.params, req.body.to);
      return reply.status(201).send(result);
    },
  );

  app.delete(
    '/records/:type/:id/links/:linkId',
    {
      schema: {
        tags,
        summary: 'Remove a link',
        params: recordParams.extend({ linkId: z.uuid() }),
      },
    },
    async (req, reply) => {
      const { linkId, ...ref } = req.params;
      await editable(req.auth, ref);
      const kernel = getKernel();
      if (!(await kernel.records.linkOf(ref, linkId))) throw httpErrors.notFound('Link not found');
      await kernel.records.unlinkById(linkId);
      return reply.status(204).send();
    },
  );

  app.get(
    '/records/:type/:id/files',
    {
      schema: {
        tags,
        summary: "A record's attachments and the upload limits",
        params: recordParams,
        response: { 200: recordFilesResponseSchema },
      },
    },
    async (req) => {
      const record = await visible(req.auth, req.params);
      const kernel = getKernel();
      const policy = await kernel.files.policy();
      return {
        record,
        files: await kernel.files.list(req.params),
        limits: { maxBytes: policy.maxBytes, blockedExtensions: policy.blockedExtensions },
      };
    },
  );

  app.post(
    '/records/:type/:id/files',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Upload one attachment (multipart/form-data, field "file")',
        consumes: ['multipart/form-data'],
        params: recordParams,
        response: { 201: fileInfoSchema },
      },
    },
    async (req, reply) => {
      await editable(req.auth, req.params);
      if (!req.isMultipart())
        throw new HttpError(400, ErrorCodes.BAD_REQUEST, 'Expected multipart/form-data');
      const part = await req.file();
      if (!part) throw new HttpError(400, ErrorCodes.BAD_REQUEST, 'No file in the request');
      const info = await getKernel().files.attach(req.params, {
        name: part.filename,
        contentType: part.mimetype,
        data: part.file,
      });
      return reply.status(201).send(info);
    },
  );

  app.get(
    '/files/:id',
    {
      schema: {
        tags,
        summary: 'Download an attachment (`inline=1` previews raster images)',
        params: z.object({ id: z.uuid() }),
        querystring: z.object({ inline: z.stringbool().default(false) }),
      },
    },
    async (req, reply) => {
      const kernel = getKernel();
      const file = await kernel.files.get(req.params.id);
      if (!file) throw httpErrors.notFound('File not found');
      await visible(req.auth, file.record);
      const stream = await kernel.files.open(file.id);
      const inline = req.query.inline && file.previewable;
      return reply
        .header('content-type', file.contentType)
        .header('content-length', String(file.size))
        .header('content-disposition', contentDisposition(inline ? 'inline' : 'attachment', file.name))
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header('cache-control', 'private, max-age=0, must-revalidate')
        .header('etag', `"${file.sha256}"`)
        .send(stream);
    },
  );

  app.delete(
    '/files/:id',
    {
      schema: { tags, summary: 'Delete an attachment', params: z.object({ id: z.uuid() }) },
    },
    async (req, reply) => {
      const kernel = getKernel();
      const file = await kernel.files.get(req.params.id);
      if (!file) throw httpErrors.notFound('File not found');
      await editable(req.auth, file.record);
      await kernel.files.remove(file.id);
      return reply.status(204).send();
    },
  );
}
