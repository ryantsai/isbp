/**
 * Azure DevOps Server stand-in under `/ado/<collection>/…`: team projects, identities, work item types and
 * fields, WIQL, work items (read, batch, as-of, JSON Patch create/update with `test /rev`, hierarchy links,
 * recycle bin), comments, Git repositories, refs, commits, branch statistics and pull requests. Requests
 * need Basic auth with the demo personal access token and an `api-version`. It behaves like the latest
 * release, Azure DevOps Server (2025+): REST 7.2, every resource only as `7.2-preview`, at most 1,000 comments per
 * work item through the API; older versions (5.0 to 7.1, as 2019 to 2022 servers speak them) are answered too,
 * with 2019's discussion API at 5.0 and the Comments API only as a preview. Changes fire service hook
 * notifications to the registered `ado` webhooks.
 *
 * Test controls under `/_mock/ado/…` edit records "as someone in Azure DevOps", push commits, open pull
 * requests and throttle the API. Web links (`webUrl`, `_links.html`) use the server's public URL,
 * `ADO_MOCK_PUBLIC_URL` (default `https://devops.example.com`, the host of the ISBP ALM demo repositories;
 * empty: this server).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { MOCK_CREDENTIALS } from '../credentials';
import type { MockContext, MockPlugin } from '../index';
import {
  aheadBehind,
  history,
  repoApiUrl,
  repoWebUrl,
  serializeCommit,
  serializeProject,
  serializeRepo,
} from './git';
import { pullRequestEvent, pushEvent, workItemEvent, workItemUpdated } from './hooks';
import { seedAdo } from './seed';
import {
  type AdoIdentity,
  type AdoProjectState,
  type AdoPullRequestState,
  type AdoRepoState,
  type AdoState,
  FIELD_DEFS,
  PROCESS_TYPES,
  shaFrom,
  type TypeDef,
  type WorkItemState,
} from './state';
import { compareFieldValues, evaluate, parseWiql, WiqlError } from './wiql';
import {
  AdoError,
  addComment,
  applyPatch,
  current,
  type Expand,
  findIdentity,
  HIERARCHY_REVERSE,
  identityRef,
  parseExpand,
  type PatchOp,
  projectOf,
  resolveIdentity,
  revisionAt,
  serialize,
  serializeComment,
  type Urls,
  type WriteResult,
} from './work-items';

export { seedAdo } from './seed';

/** Azure DevOps Server (2025 and later): REST 7.2, most resources only as `7.2-preview.N`. */
const SUPPORTED_MAX = [7, 2] as const;
/** Comments the REST API adds per work item, at most (Azure DevOps Server, 2025+). */
const MAX_API_COMMENTS = 1000;
const MAX_IDS = 200;
const WIQL_CAP = 20_000;

type Q = Record<string, string | undefined>;
type Req = FastifyRequest<{ Params: Record<string, string>; Querystring: Q; Body: unknown }>;

const lower = (s: string) => s.toLowerCase();

function sendError(reply: FastifyReply, err: AdoError) {
  return reply.code(err.status).send({
    $id: '1',
    innerException: null,
    message: err.message,
    typeName: err.typeName,
    typeKey: err.typeKey,
    errorCode: 0,
    eventId: err.workItemTracking ? 3200 : 3000,
    ...err.extra,
  });
}

/** `7.0`, `7.0-preview`, `7.1-preview.4` → parts; null when malformed. */
function parseVersion(raw: string) {
  const m = /^(\d+)\.(\d+)(-preview(\.\d+)?)?$/.exec(raw.trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]), preview: Boolean(m[3]) } : null;
}

function requestedVersion(req: FastifyRequest): string | null {
  const q = (req.query as Q)['api-version'];
  if (q) return q;
  const accept = req.headers.accept ?? '';
  const m = /api-version=([0-9.a-z-]+)/i.exec(accept);
  return m ? m[1]! : null;
}

function ids(raw: unknown): number[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  const out = list.map((x) => Number(String(x).trim())).filter((n) => Number.isInteger(n) && n > 0);
  if (!out.length)
    throw new AdoError(400, 'VS402331: The ids parameter is required.', 'VssPropertyValidationException');
  if (out.length > MAX_IDS)
    throw new AdoError(
      400,
      `VS402335: The number of work item ids (${out.length}) exceeds the limit of ${MAX_IDS}.`,
      'VssPropertyValidationException',
    );
  return out;
}

const notFound = (id: number) =>
  new AdoError(
    404,
    `TF401232: Work item ${id} does not exist, or you do not have permissions to read it.`,
    'WorkItemUnauthorizedAccessException',
  );

export const adoMock: MockPlugin = {
  name: 'ado',
  register(app: FastifyInstance, ctx: MockContext) {
    const state = () => ctx.store.get<AdoState>('ado', () => seedAdo());
    const publicUrl = () => {
      const env = process.env.ADO_MOCK_PUBLIC_URL;
      return (env === undefined ? 'https://devops.example.com' : env || `${ctx.baseUrl()}/ado`).replace(
        /\/+$/,
        '',
      );
    };
    const urls = (s: AdoState): Urls => ({
      api: `${ctx.baseUrl()}/ado/${s.collection.name}`,
      web: `${publicUrl()}/${s.collection.name}`,
    });
    const caller = (s: AdoState) => s.patIdentity;

    const project = (s: AdoState, raw: string | undefined): AdoProjectState => {
      const v = decodeURIComponent(raw ?? '');
      const p =
        s.projects.find((x) => x.id === lower(v)) ?? s.projects.find((x) => lower(x.name) === lower(v));
      if (!p)
        throw new AdoError(
          404,
          `TF200016: The following project does not exist: ${v}. Verify that the name of the project is correct and that the project exists on the specified Azure DevOps Server.`,
          'ProjectDoesNotExistWithNameException',
        );
      return p;
    };
    const item = (s: AdoState, id: string | number, inProject?: AdoProjectState): WorkItemState => {
      const n = Number(id);
      const w = s.workItems[String(n)];
      if (!w || w.deleted || (inProject && w.projectId !== inProject.id)) throw notFound(n);
      return w;
    };
    const repo = (s: AdoState, raw: string, inProject?: AdoProjectState): AdoRepoState => {
      const v = lower(decodeURIComponent(raw));
      const r = s.repos.find(
        (x) => (x.id === v || lower(x.name) === v) && (!inProject || x.projectId === inProject.id),
      );
      if (!r)
        throw new AdoError(
          404,
          `TF401019: The Git repository with name or identifier ${raw} does not exist or you do not have permissions for the operation you are attempting.`,
          'GitRepositoryNotFoundException',
        );
      return r;
    };
    const fire = (body: unknown) => {
      ctx.notify('ado', body);
    };
    const afterWrite = (s: AdoState, result: WriteResult, created: boolean, by: string, notify = true) => {
      ctx.store.changed();
      if (!notify) return;
      const u = urls(s);
      fire(
        created
          ? workItemEvent(s, u, 'workitem.created', result.item, by)
          : workItemUpdated(s, u, result.item, result.changes, by),
      );
      for (const t of result.touched) fire(workItemUpdated(s, u, t.item, t.changes, by));
    };

    /* ───────────────────────────── REST API ───────────────────────────── */

    app.register(
      async (api) => {
        api.setErrorHandler((err, _req, reply) => {
          if (err instanceof AdoError) return sendError(reply, err);
          if (err instanceof WiqlError) return sendError(reply, new AdoError(400, err.message, err.typeKey));
          const status = (err as { statusCode?: number }).statusCode ?? 500;
          return sendError(
            reply,
            new AdoError(
              status,
              (err as Error).message,
              status >= 500 ? 'ServerException' : 'VssPropertyValidationException',
            ),
          );
        });

        api.addHook('onRequest', async (req, reply) => {
          const s = state();
          const params = req.params as { collection?: string };
          if (lower(params.collection ?? '') !== lower(s.collection.name))
            return sendError(
              reply,
              new AdoError(
                404,
                `TF400918: The collection ${params.collection} could not be found.`,
                'CollectionDoesNotExistException',
              ),
            );
          // The web page of a work item (the links the connector reports) opens without a token in the stand-in.
          if (req.method === 'GET' && /\/_workitems\/edit\/\d+\/?(\?|$)/.test(req.url)) return;
          const auth = req.headers.authorization ?? '';
          const m = /^Basic\s+(.+)$/i.exec(auth);
          const password = m
            ? Buffer.from(m[1]!, 'base64').toString('utf8').split(':').slice(1).join(':')
            : null;
          if (password !== MOCK_CREDENTIALS.ado.pat) {
            reply.header('www-authenticate', `Basic realm="${ctx.baseUrl()}/ado"`);
            return sendError(
              reply,
              new AdoError(
                401,
                'TF400813: Resource not available for anonymous access. Client authentication required.',
                'UnauthorizedRequestException',
              ),
            );
          }
          if (s.rateLimit) {
            const { retryAfter } = s.rateLimit;
            if (s.rateLimit.remaining > 0) s.rateLimit.remaining -= 1;
            if (s.rateLimit.remaining === 0) s.rateLimit = null;
            reply
              .header('retry-after', String(retryAfter))
              .header('x-ratelimit-resource', 'ATCPU')
              .header('x-ratelimit-delay', '0.5')
              .header('x-ratelimit-limit', '200')
              .header('x-ratelimit-remaining', '0')
              .header('x-ratelimit-reset', String(Math.ceil(Date.now() / 1000) + retryAfter));
            return sendError(
              reply,
              new AdoError(
                429,
                `TF400733: The request has been canceled: Request was blocked due to exceeding usage of resource 'ATCPU' in namespace 'User'.`,
                'RequestBlockedException',
              ),
            );
          }
          if (req.url.split('?')[0]!.endsWith('/_apis/connectionData')) return;
          const raw = requestedVersion(req);
          if (!raw)
            return sendError(
              reply,
              new AdoError(
                400,
                `No api-version was supplied for the "${req.method}" request. The version must be supplied either as part of the Accept header (e.g. "application/json; api-version=1.0") or as a query parameter (e.g. "?api-version=1.0").`,
                'VssVersionNotSpecifiedException',
              ),
            );
          const v = parseVersion(raw);
          if (!v)
            return sendError(
              reply,
              new AdoError(400, `The api-version '${raw}' is not valid.`, 'VssInvalidApiVersionException'),
            );
          if (v.major > SUPPORTED_MAX[0] || (v.major === SUPPORTED_MAX[0] && v.minor > SUPPORTED_MAX[1]))
            return sendError(
              reply,
              new AdoError(
                400,
                `The requested REST API version of ${raw} is out of range for this server. The latest REST API version this server supports is ${SUPPORTED_MAX.join('.')}.`,
                'VssVersionOutOfRangeException',
              ),
            );
          // Comments are a preview on every version; at 7.2 every resource is served as a preview.
          const previewOnly = /\/comments(\/|$|\?)/i.test(req.url) || (v.major === 7 && v.minor === 2);
          if (previewOnly && !v.preview)
            return sendError(
              reply,
              new AdoError(
                400,
                `The requested version "${raw}" of the resource is under preview. The -preview flag must be supplied in the api-version for such requests. For example: "${raw}-preview"`,
                'VssInvalidPreviewVersionException',
              ),
            );
        });

        const u = () => urls(state());
        /** Server 2019's comments API (api-version 5.0): the read-only discussion. */
        const legacy = (req: FastifyRequest) => {
          const v = parseVersion(requestedVersion(req) ?? '');
          return Boolean(v && (v.major < 5 || (v.major === 5 && v.minor === 0)));
        };
        /** Comments carry `format` and `renderedText` from 7.1 on. */
        const v71 = (req: FastifyRequest) => {
          const v = parseVersion(requestedVersion(req) ?? '');
          return Boolean(v && (v.major > 7 || (v.major === 7 && v.minor >= 1)));
        };
        const list = <T>(value: T[]) => ({ count: value.length, value });
        const identityJson = (i: AdoIdentity) => {
          const [domain, account] = i.uniqueName.includes('\\')
            ? i.uniqueName.split('\\')
            : ['', i.uniqueName];
          return {
            id: i.id,
            descriptor: `System.Security.Principal.WindowsIdentity;S-1-5-21-${parseInt(i.id.slice(0, 8), 16)}`,
            subjectDescriptor: `win.${Buffer.from(i.id).toString('base64url')}`,
            providerDisplayName: i.displayName,
            isActive: true,
            isContainer: false,
            members: [],
            memberOf: [],
            memberIds: [],
            properties: {
              SchemaClassName: { $type: 'System.String', $value: 'User' },
              Description: { $type: 'System.String', $value: '' },
              Domain: { $type: 'System.String', $value: domain },
              Account: { $type: 'System.String', $value: account },
              DN: { $type: 'System.String', $value: '' },
              Mail: { $type: 'System.String', $value: i.mail ?? '' },
              SpecialType: { $type: 'System.String', $value: 'Generic' },
            },
            resourceVersion: 2,
            metaTypeId: 0,
          };
        };

        /* connection, projects, identities */

        api.get('/_apis/connectionData', async () => {
          const s = state();
          const me = identityJson(findIdentity(s, caller(s))!);
          return {
            authenticatedUser: me,
            authorizedUser: me,
            instanceId: s.collection.id,
            deploymentId: s.serverId,
            deploymentType: 'onPremises',
            locationServiceData: {
              serviceOwner: s.serverId,
              defaultAccessMappingMoniker: 'PublicAccessMapping',
              lastChangeId: 1,
            },
          };
        });

        api.get('/_apis/projects', async (req: Req, reply) => {
          const s = state();
          const top = Math.max(1, Math.min(1000, Number(req.query.$top ?? 100) || 100));
          const skip = Number(req.query.continuationToken ?? req.query.$skip ?? 0) || 0;
          const all = [...s.projects].sort((a, b) => a.name.localeCompare(b.name));
          const page = all.slice(skip, skip + top);
          if (skip + top < all.length) reply.header('x-ms-continuationtoken', String(skip + top));
          return list(page.map((p) => serializeProject(u(), p)));
        });

        api.get('/_apis/projects/:project', async (req: Req) => {
          const s = state();
          const p = project(s, req.params.project);
          const out: Record<string, unknown> = {
            ...serializeProject(u(), p),
            _links: { web: { href: `${u().web}/${encodeURIComponent(p.name)}` } },
            defaultTeam: { id: p.id, name: `${p.name} Team` },
          };
          if (req.query.includeCapabilities === 'true')
            out.capabilities = {
              versioncontrol: { sourceControlType: 'Git', gitEnabled: 'true', tfvcEnabled: 'false' },
              processTemplate: { templateName: p.process, templateTypeId: `process:${p.process}` },
            };
          return out;
        });

        api.get('/_apis/identities', async (req: Req) => {
          const s = state();
          if (req.query.identityIds) {
            const wanted = req.query.identityIds.split(',').map((x) => lower(x.trim()));
            return list(
              wanted.map((id) => {
                const i = findIdentity(s, id);
                return i ? identityJson(i) : null;
              }),
            );
          }
          const filter = lower(req.query.searchFilter ?? '');
          const value = lower(req.query.filterValue ?? '');
          if (!filter || !value)
            throw new AdoError(
              400,
              'Specify identityIds or searchFilter and filterValue.',
              'VssPropertyValidationException',
            );
          const hits =
            filter === 'mailaddress'
              ? s.identities.filter((i) => lower(i.mail ?? '') === value)
              : filter === 'accountname'
                ? s.identities.filter((i) => lower(i.uniqueName) === value)
                : filter === 'displayname'
                  ? s.identities.filter((i) => lower(i.displayName).includes(value))
                  : filter === 'general'
                    ? [resolveIdentity(s, value)].filter((i): i is AdoIdentity => Boolean(i))
                    : null;
          if (!hits)
            throw new AdoError(
              400,
              `The search filter ${req.query.searchFilter} is not supported.`,
              'VssPropertyValidationException',
            );
          return list(hits.map(identityJson));
        });

        /* fields and types */

        api.get('/_apis/wit/fields', async () =>
          list(
            Object.entries(FIELD_DEFS).map(([ref, f]) => ({
              name: f.name,
              referenceName: ref,
              description: '',
              type: f.type,
              usage: 'workItem',
              readOnly: Boolean(f.readOnly),
              canSortBy: true,
              isQueryable: true,
              supportedOperations: [],
              isIdentity: f.type === 'identity',
              isPicklist: false,
              isPicklistSuggested: false,
              url: `${u().api}/_apis/wit/fields/${ref}`,
            })),
          ),
        );

        const typeJson = (p: AdoProjectState, t: TypeDef) => {
          const fields = t.fields.map((ref) => ({
            referenceName: ref,
            name: FIELD_DEFS[ref]!.name,
            url: `${u().api}/_apis/wit/fields/${ref}`,
            alwaysRequired: ref === 'System.Title',
            defaultValue: null,
            helpText: null,
          }));
          return {
            name: t.name,
            referenceName: t.referenceName,
            description: `${t.name} (${p.process})`,
            color: t.color,
            icon: { id: t.icon, url: `${u().api}/_apis/wit/workItemIcons/${t.icon}?color=${t.color}&v=2` },
            isDisabled: false,
            xmlForm: '',
            fields,
            fieldInstances: fields,
            states: t.states.map(([name, category]) => ({
              name,
              color: category === 'Completed' ? '339933' : category === 'InProgress' ? '007acc' : 'b2b2b2',
              category,
            })),
            transitions: Object.fromEntries([
              ['', [{ to: t.states[0]![0], actions: null }]],
              ...t.states.map(([name]) => [
                name,
                t.states.filter(([n]) => n !== name).map(([to]) => ({ to, actions: null })),
              ]),
            ]),
            url: `${u().api}/${p.id}/_apis/wit/workItemTypes/${encodeURIComponent(t.name)}`,
          };
        };
        const findType = (p: AdoProjectState, name: string) => {
          const t = PROCESS_TYPES[p.process].find((x) => lower(x.name) === lower(decodeURIComponent(name)));
          if (!t)
            throw new AdoError(
              404,
              `VS402323: Work item type ${name} does not exist in project ${p.name} or you do not have permission to access it.`,
              'WorkItemTypeNotFoundException',
            );
          return t;
        };
        for (const seg of ['workitemtypes', 'workItemTypes']) {
          api.get(`/:project/_apis/wit/${seg}`, async (req: Req) => {
            const p = project(state(), req.params.project);
            const types = PROCESS_TYPES[p.process].map((t) => typeJson(p, t));
            // Like Server 2019's samples, 5.x answers without `states` (clients use the states resource).
            const v = parseVersion(requestedVersion(req) ?? '');
            return list(v && v.major < 6 ? types.map(({ states: _states, ...rest }) => rest) : types);
          });
          api.get(`/:project/_apis/wit/${seg}/:type`, async (req: Req) => {
            const p = project(state(), req.params.project);
            return typeJson(p, findType(p, req.params.type!));
          });
          api.get(`/:project/_apis/wit/${seg}/:type/states`, async (req: Req) => {
            // A preview resource before 7.0.
            const raw = requestedVersion(req) ?? '';
            const v = parseVersion(raw);
            if (v && v.major < 7 && !v.preview)
              throw new AdoError(
                400,
                `The requested version "${raw}" of the resource is under preview. The -preview flag must be supplied in the api-version for such requests. For example: "${raw}-preview"`,
                'VssInvalidPreviewVersionException',
              );
            const p = project(state(), req.params.project);
            const t = findType(p, req.params.type!);
            return list(typeJson(p, t).states);
          });
        }

        /* WIQL */

        const runWiql = (req: Req, p: AdoProjectState | null) => {
          const s = state();
          const body = (req.body ?? {}) as { query?: unknown };
          if (typeof body.query !== 'string' || !body.query.trim())
            throw new AdoError(
              400,
              'VS402336: The query text is required.',
              'VssPropertyValidationException',
            );
          const q = parseWiql(body.query);
          const timePrecision = req.query.timePrecision === 'true';
          const top = req.query.$top !== undefined ? Number(req.query.$top) : null;
          if (top !== null && (!Number.isInteger(top) || top < 1))
            throw new AdoError(
              400,
              `The value ${req.query.$top} is not valid for $top.`,
              'VssPropertyValidationException',
            );
          const now = Date.now();
          const asOf = q.asOf ? new Date(q.asOf).toISOString() : new Date(now).toISOString();
          const me = findIdentity(s, caller(s))!;
          const evalCtx = {
            project: p?.name ?? null,
            me: [me.uniqueName, me.displayName, me.mail ?? ''],
            timePrecision,
            identity: (id: string) => {
              const i = findIdentity(s, id);
              return i ? [i.uniqueName, i.displayName, i.mail ?? ''].filter(Boolean) : [];
            },
            now,
          };
          const rows: { id: number; fields: Record<string, unknown> }[] = [];
          for (const w of Object.values(s.workItems)) {
            if (w.deleted) continue;
            const rev = revisionAt(w, q.asOf ? asOf : null);
            if (rev && evaluate(q.where, rev.fields, evalCtx)) rows.push({ id: w.id, fields: rev.fields });
          }
          rows.sort((a, b) => {
            for (const o of q.orderBy) {
              const c = compareFieldValues(o.field, a.fields[o.field], b.fields[o.field]);
              if (c !== 0) return o.desc ? -c : c;
            }
            return a.id - b.id;
          });
          if (top === null && rows.length > WIQL_CAP)
            throw new AdoError(
              400,
              `VS402337: The number of work items returned exceeds the size limit of ${WIQL_CAP}. Change the query to return fewer items.`,
              'WorkItemTrackingQueryResultSizeLimitExceededException',
            );
          const page = top === null ? rows : rows.slice(0, top);
          const col = (ref: string) => ({
            referenceName: ref,
            name: FIELD_DEFS[ref]!.name,
            url: `${u().api}/_apis/wit/fields/${ref}`,
          });
          return {
            queryType: 'flat',
            queryResultType: 'workItem',
            asOf,
            columns: q.fields.map(col),
            sortColumns: q.orderBy.map((o) => ({ field: col(o.field), descending: o.desc })),
            workItems: page.map((r) => ({ id: r.id, url: `${u().api}/_apis/wit/workItems/${r.id}` })),
          };
        };
        api.post('/:project/_apis/wit/wiql', async (req: Req) =>
          runWiql(req, project(state(), req.params.project)),
        );
        api.post('/_apis/wit/wiql', async (req: Req) => runWiql(req, null));

        /* web page of a work item (read-only, for links in the demo) */

        api.get('/:project/_workitems/edit/:id', async (req: Req, reply) => {
          const s = state();
          const w = item(s, req.params.id!, project(s, req.params.project));
          const f = current(w).fields;
          const esc = (v: unknown) =>
            String(v ?? '').replace(
              /[&<>"']/g,
              (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
            );
          const text = (v: unknown) =>
            esc(
              String(v ?? '')
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim(),
            );
          const who = (v: unknown) => {
            const id = (v as { $identity?: string } | undefined)?.$identity;
            return id ? (findIdentity(s, id)?.displayName ?? '') : '';
          };
          const rows: [string, string][] = [
            ['State', esc(f['System.State'])],
            ['Assigned To', esc(who(f['System.AssignedTo']))],
            ['Area Path', esc(f['System.AreaPath'])],
            ['Iteration Path', esc(f['System.IterationPath'])],
            ['Tags', esc(f['System.Tags'])],
            ['Priority', esc(f['Microsoft.VSTS.Common.Priority'])],
            ['Remaining Work', esc(f['Microsoft.VSTS.Scheduling.RemainingWork'])],
            ['Changed', esc(f['System.ChangedDate'])],
            ['Description', text(f['System.Description'] ?? f['Microsoft.VSTS.TCM.ReproSteps'])],
          ];
          reply
            .type('text/html; charset=utf-8')
            .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'");
          return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(f['System.WorkItemType'])} ${w.id}: ${esc(f['System.Title'])}</title>
<style>body{font:15px system-ui,sans-serif;margin:2rem;max-width:48rem;color:#1b1b1b}dt{font-weight:600;margin-top:.6rem}dd{margin:0}small{color:#555}</style></head>
<body><small>Azure DevOps Server stand-in · ${esc(projectOf(s, w).name)} · rev ${current(w).rev}</small>
<h1>${esc(f['System.WorkItemType'])} ${w.id}: ${esc(f['System.Title'])}</h1>
<dl>${rows
            .filter(([, v]) => v)
            .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
            .join('')}</dl>
<h2>Discussion</h2>${
            w.comments
              .filter((c) => !c.isDeleted)
              .map(
                (c) =>
                  `<p><b>${esc(findIdentity(s, c.createdBy)?.displayName)}</b> <small>${esc(c.createdDate)}</small><br>${text(c.text)}</p>`,
              )
              .join('') || '<p>No comments.</p>'
          }
</body></html>`;
        });

        /* reading work items */

        const readMany = (
          s: AdoState,
          list: number[],
          opts: { expand: Expand; fields: string[] | null; asOf: string | null; omit: boolean },
          p?: AdoProjectState,
        ) =>
          list.map((id) => {
            const w = s.workItems[String(id)];
            const rev = w && !w.deleted && (!p || w.projectId === p.id) ? revisionAt(w, opts.asOf) : null;
            if (!w || !rev) {
              if (opts.omit) return null;
              throw notFound(id);
            }
            return serialize(s, u(), w, rev, { expand: opts.expand, fields: opts.fields });
          });
        const readOptions = (raw: {
          fields?: unknown;
          expand?: unknown;
          asOf?: unknown;
          errorPolicy?: unknown;
        }) => {
          const fields = raw.fields
            ? (Array.isArray(raw.fields) ? raw.fields.map(String) : String(raw.fields).split(','))
                .map((f) => f.trim())
                .filter(Boolean)
            : null;
          const expand = parseExpand(raw.expand);
          if (fields?.length && expand !== 'none')
            throw new AdoError(
              400,
              'The expand parameter can not be used with the fields parameter.',
              'ConflictingParametersException',
            );
          return {
            fields: fields?.length ? fields : null,
            expand,
            asOf: raw.asOf ? String(raw.asOf) : null,
            omit: lower(String(raw.errorPolicy ?? 'fail')) === 'omit',
          };
        };
        for (const prefix of ['', '/:project']) {
          for (const seg of ['workitems', 'workItems']) {
            api.get(`${prefix}/_apis/wit/${seg}`, async (req: Req) => {
              const s = state();
              const p = req.params.project ? project(s, req.params.project) : undefined;
              const opts = readOptions({
                fields: req.query.fields,
                expand: req.query.$expand,
                asOf: req.query.asOf,
                errorPolicy: req.query.errorPolicy,
              });
              return list(readMany(s, ids(req.query.ids), opts, p));
            });
            api.get(`${prefix}/_apis/wit/${seg}/:id`, async (req: Req) => {
              const s = state();
              const p = req.params.project ? project(s, req.params.project) : undefined;
              const w = item(s, req.params.id!, p);
              const opts = readOptions({
                fields: req.query.fields,
                expand: req.query.$expand,
                asOf: req.query.asOf,
              });
              const rev = revisionAt(w, opts.asOf);
              if (!rev) throw notFound(w.id);
              return serialize(s, u(), w, rev, {
                expand: opts.expand,
                fields: opts.fields,
                links: opts.expand === 'none' && !opts.fields,
              });
            });
            api.patch(`${prefix}/_apis/wit/${seg}/:id`, async (req: Req) => {
              const s = state();
              const p = req.params.project ? project(s, req.params.project) : undefined;
              const validateOnly = req.query.validateOnly === 'true';
              const target = validateOnly ? structuredClone(s) : s;
              const w = item(target, req.params.id!, p);
              const result = applyPatch(target, {
                project: projectOf(target, w),
                item: w,
                ops: req.body,
                by: caller(s),
                bypassRules: req.query.bypassRules === 'true',
              });
              if (!validateOnly && result.changed)
                afterWrite(s, result, false, caller(s), req.query.suppressNotifications !== 'true');
              return serialize(target, u(), result.item, current(result.item), {
                expand: parseExpand(req.query.$expand),
                links: true,
              });
            });
          }
          api.post(`${prefix}/_apis/wit/workitemsbatch`, async (req: Req) => {
            const s = state();
            const p = req.params.project ? project(s, req.params.project) : undefined;
            const body = (req.body ?? {}) as {
              ids?: unknown;
              fields?: unknown;
              $expand?: unknown;
              asOf?: unknown;
              errorPolicy?: unknown;
            };
            const opts = readOptions({
              fields: body.fields,
              expand: body.$expand,
              asOf: body.asOf,
              errorPolicy: body.errorPolicy,
            });
            return list(readMany(s, ids(body.ids), opts, p));
          });
        }

        /* creating and deleting work items */

        for (const seg of ['workitems', 'workItems']) {
          // POST {project}/_apis/wit/workitems/${type}: the type comes with a `$` in front.
          api.post(`/:project/_apis/wit/${seg}/:id`, async (req: Req, reply) => {
            const s = state();
            const p = project(s, req.params.project);
            const rawType = decodeURIComponent(req.params.id!);
            if (!rawType.startsWith('$'))
              throw new AdoError(
                405,
                'The requested resource does not support http method POST.',
                'HttpMethodNotAllowedException',
              );
            const validateOnly = req.query.validateOnly === 'true';
            const target = validateOnly ? structuredClone(s) : s;
            const result = applyPatch(target, {
              project: project(target, p.id),
              type: rawType.slice(1),
              item: null,
              ops: req.body,
              by: caller(s),
              bypassRules: req.query.bypassRules === 'true',
            });
            if (!validateOnly)
              afterWrite(s, result, true, caller(s), req.query.suppressNotifications !== 'true');
            reply.code(200);
            return serialize(target, u(), result.item, current(result.item), {
              expand: parseExpand(req.query.$expand),
              links: true,
            });
          });
          for (const prefix of ['', '/:project'])
            api.delete(`${prefix}/_apis/wit/${seg}/:id`, async (req: Req) => {
              const s = state();
              const p = req.params.project ? project(s, req.params.project) : undefined;
              const w = item(s, req.params.id!, p);
              if (req.query.destroy === 'true') delete s.workItems[String(w.id)];
              else w.deleted = true;
              ctx.store.changed();
              fire(workItemEvent(s, u(), 'workitem.deleted', w, caller(s)));
              const f = current(w).fields;
              return {
                id: w.id,
                type: f['System.WorkItemType'],
                name: f['System.Title'],
                project: f['System.TeamProject'],
                deletedDate: new Date().toISOString(),
                deletedBy: identityRef(s, u(), caller(s))?.displayName,
                code: 200,
                url: `${u().api}/${w.projectId}/_apis/wit/recycleBin/${w.id}`,
              };
            });
        }

        /* comments (preview API) */

        for (const seg of ['workItems', 'workitems']) {
          api.get(`/:project/_apis/wit/${seg}/:id/comments`, async (req: Req) => {
            const s = state();
            const w = item(s, req.params.id!, project(s, req.params.project));
            if (legacy(req)) {
              // Server 2019 (5.0-preview.2): the discussion, one entry per revision.
              const from = Number(req.query.fromRevision ?? 1) || 1;
              const top = Math.max(1, Math.min(200, Number(req.query.$top ?? 200) || 200));
              const asc = lower(req.query.order ?? 'asc') !== 'desc';
              const entries = w.comments
                .filter((c) => !c.isDeleted && (c.rev ?? 0) >= from)
                .sort((a, b) => (asc ? 1 : -1) * ((a.rev ?? 0) - (b.rev ?? 0)))
                .slice(0, top);
              return {
                totalCount: w.comments.filter((c) => !c.isDeleted).length,
                fromRevisionCount: entries.length,
                count: entries.length,
                comments: entries.map((c) => ({
                  revision: c.rev,
                  text: c.text,
                  revisedBy: identityRef(s, u(), c.createdBy),
                  revisedDate: c.createdDate,
                  url: `${u().api}/_apis/wit/workItems/${w.id}/comments/${c.rev}`,
                })),
              };
            }
            const includeDeleted = req.query.includeDeleted === 'true';
            const order = lower(req.query.order ?? 'desc') === 'asc' ? 1 : -1;
            const all = w.comments
              .filter((c) => includeDeleted || !c.isDeleted)
              .sort((a, b) => order * (a.createdDate.localeCompare(b.createdDate) || a.id - b.id));
            const top = Math.max(1, Math.min(200, Number(req.query.$top ?? 200) || 200));
            const skip = Number(req.query.continuationToken ?? 0) || 0;
            const page = all.slice(skip, skip + top);
            const more = skip + top < all.length;
            return {
              totalCount: all.length,
              count: page.length,
              comments: page.map((c) => serializeComment(s, u(), w, c, v71(req))),
              ...(more
                ? {
                    continuationToken: String(skip + top),
                    nextPage: `${u().api}/${w.projectId}/_apis/wit/workItems/${w.id}/comments?continuationToken=${skip + top}`,
                  }
                : {}),
              url: `${u().api}/${w.projectId}/_apis/wit/workItems/${w.id}/comments`,
            };
          });
          api.post(`/:project/_apis/wit/${seg}/:id/comments`, async (req: Req) => {
            const s = state();
            const w = item(s, req.params.id!, project(s, req.params.project));
            if (legacy(req))
              throw new AdoError(
                405,
                'The requested resource does not support http method POST.',
                'HttpMethodNotAllowedException',
              );
            const text = (req.body as { text?: unknown } | null)?.text;
            if (typeof text !== 'string')
              throw new AdoError(400, 'The comment text is required.', 'VssPropertyValidationException');
            if (v71(req) && !req.query.format)
              throw new AdoError(400, 'The format parameter is required.', 'VssPropertyValidationException');
            const format = lower(req.query.format ?? 'html');
            if (format !== 'html' && format !== 'markdown')
              throw new AdoError(
                400,
                `The value ${req.query.format} is not valid for format.`,
                'VssPropertyValidationException',
              );
            if (format === 'markdown' && !v71(req))
              throw new AdoError(
                400,
                'Markdown comments need api-version 7.1-preview.4.',
                'VssPropertyValidationException',
              );
            const v = parseVersion(requestedVersion(req) ?? '');
            if (v && v.major === 7 && v.minor >= 2 && w.comments.length >= MAX_API_COMMENTS)
              // The exact message and type of this refusal aren't documented; the limit is.
              throw new AdoError(
                400,
                `Work item ${w.id} has reached the limit of ${MAX_API_COMMENTS} comments that can be added through the REST API. Add further comments in the web portal.`,
                'WorkItemCommentLimitExceededException',
              );
            const c = addComment(s, w, text, caller(s), format);
            ctx.store.changed();
            fire(workItemEvent(s, u(), 'workitem.commented', w, caller(s)));
            return serializeComment(s, u(), w, c, v71(req));
          });
        }

        /* Git */

        const refJson = (r: AdoRepoState, name: string) => ({
          name,
          objectId: r.refs[name],
          creator: identityRef(state(), u(), state().patIdentity),
          url: `${repoApiUrl(u(), r)}/refs?filter=${encodeURIComponent(name.replace(/^refs\//, ''))}`,
        });
        const prJson = (s: AdoState, pr: AdoPullRequestState) => {
          const r = s.repos.find((x) => x.id === pr.repoId)!;
          const p = s.projects.find((x) => x.id === r.projectId)!;
          const head = r.refs[pr.sourceRefName];
          const base = r.refs[pr.targetRefName];
          return {
            repository: {
              id: r.id,
              name: r.name,
              url: repoApiUrl(u(), r),
              project: serializeProject(u(), p),
            },
            pullRequestId: pr.id,
            codeReviewId: pr.id,
            status: pr.status,
            createdBy: identityRef(s, u(), pr.createdBy),
            creationDate: pr.creationDate,
            title: pr.title,
            description: pr.description,
            sourceRefName: pr.sourceRefName,
            targetRefName: pr.targetRefName,
            mergeStatus: 'succeeded',
            isDraft: pr.isDraft,
            mergeId: shaFrom(`merge:${pr.id}`)
              .slice(0, 32)
              .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'),
            ...(head
              ? { lastMergeSourceCommit: { commitId: head, url: `${repoApiUrl(u(), r)}/commits/${head}` } }
              : {}),
            ...(base
              ? { lastMergeTargetCommit: { commitId: base, url: `${repoApiUrl(u(), r)}/commits/${base}` } }
              : {}),
            reviewers: [],
            url: `${repoApiUrl(u(), r)}/pullRequests/${pr.id}`,
            supportsIterations: true,
          };
        };
        const branchRef = (r: AdoRepoState, version: string | undefined, type: string | undefined) => {
          const v = version ?? r.defaultBranch.replace('refs/heads/', '');
          if (lower(type ?? 'branch') === 'commit') {
            if (!r.commits[v])
              throw new AdoError(
                404,
                `TF401175: The version descriptor <Commit: ${v}> could not be resolved to a version on the repository ${r.name}`,
                'GitUnresolvableToCommitException',
              );
            return v;
          }
          const sha = r.refs[`refs/heads/${v}`];
          if (!sha)
            throw new AdoError(
              404,
              `TF401175: The version descriptor <Branch: ${v}> could not be resolved to a version on the repository ${r.name}`,
              'GitUnresolvableToCommitException',
            );
          return sha;
        };

        for (const prefix of ['', '/:project']) {
          const scope = (req: Req, s: AdoState) =>
            req.params.project ? project(s, req.params.project) : undefined;
          api.get(`${prefix}/_apis/git/repositories`, async (req: Req) => {
            const s = state();
            const p = scope(req, s);
            return list(
              s.repos.filter((r) => !p || r.projectId === p.id).map((r) => serializeRepo(s, u(), r)),
            );
          });
          api.get(`${prefix}/_apis/git/repositories/:repo`, async (req: Req) => {
            const s = state();
            return serializeRepo(s, u(), repo(s, req.params.repo!, scope(req, s)));
          });
          api.get(`${prefix}/_apis/git/repositories/:repo/refs`, async (req: Req, reply) => {
            const s = state();
            const r = repo(s, req.params.repo!, scope(req, s));
            const filter = req.query.filter ? `refs/${req.query.filter}` : 'refs/';
            const contains = lower(req.query.filterContains ?? '');
            const names = Object.keys(r.refs)
              .filter((n) => n.startsWith(filter) && (!contains || lower(n).includes(contains)))
              .sort();
            const top = Math.max(1, Math.min(1000, Number(req.query.$top ?? 1000) || 1000));
            const skip = Number(req.query.continuationToken ?? 0) || 0;
            if (skip + top < names.length) reply.header('x-ms-continuationtoken', String(skip + top));
            return list(names.slice(skip, skip + top).map((n) => refJson(r, n)));
          });
          api.get(`${prefix}/_apis/git/repositories/:repo/commits`, async (req: Req) => {
            const s = state();
            const r = repo(s, req.params.repo!, scope(req, s));
            const sha = branchRef(
              r,
              req.query['searchCriteria.itemVersion.version'],
              req.query['searchCriteria.itemVersion.versionType'],
            );
            const top = Number(req.query['searchCriteria.$top'] ?? req.query.$top ?? 100) || 100;
            const skip = Number(req.query['searchCriteria.$skip'] ?? req.query.$skip ?? 0) || 0;
            const web = repoWebUrl(s, u(), r);
            return list(
              history(r, sha)
                .slice(skip, skip + top)
                .map((c) => serializeCommit(u(), r, c, web)),
            );
          });
          api.get(`${prefix}/_apis/git/repositories/:repo/stats/branches`, async (req: Req) => {
            const s = state();
            const r = repo(s, req.params.repo!, scope(req, s));
            const baseName =
              req.query['baseVersionDescriptor.version'] ?? r.defaultBranch.replace('refs/heads/', '');
            branchRef(r, baseName, 'branch');
            const web = repoWebUrl(s, u(), r);
            const names = Object.keys(r.refs)
              .filter((n) => n.startsWith('refs/heads/'))
              .map((n) => n.replace('refs/heads/', ''))
              .filter((n) => !req.query.name || n === req.query.name)
              .sort();
            return list(
              names.map((name) => {
                const { ahead, behind } = aheadBehind(r, `refs/heads/${name}`, `refs/heads/${baseName}`);
                return {
                  commit: serializeCommit(u(), r, r.commits[r.refs[`refs/heads/${name}`]!]!, web),
                  name,
                  aheadCount: ahead,
                  behindCount: behind,
                  isBaseVersion: name === baseName,
                };
              }),
            );
          });
          for (const seg of ['pullrequests', 'pullRequests'])
            api.get(`${prefix}/_apis/git/repositories/:repo/${seg}`, async (req: Req) => {
              const s = state();
              const r = repo(s, req.params.repo!, scope(req, s));
              const status = lower(req.query['searchCriteria.status'] ?? 'active');
              const top = Number(req.query.$top ?? 101) || 101;
              const skip = Number(req.query.$skip ?? 0) || 0;
              const prs = s.pullRequests
                .filter((pr) => pr.repoId === r.id && (status === 'all' || pr.status === status))
                .sort((a, b) => b.creationDate.localeCompare(a.creationDate) || b.id - a.id);
              return list(prs.slice(skip, skip + top).map((pr) => prJson(s, pr)));
            });
        }
      },
      { prefix: '/ado/:collection' },
    );

    /* ───────────────────────────── test controls ───────────────────────────── */

    app.register(
      async (ctl) => {
        ctl.setErrorHandler((err, _req, reply) => {
          if (err instanceof AdoError) return sendError(reply, err);
          return reply
            .code((err as { statusCode?: number }).statusCode ?? 500)
            .send({ message: (err as Error).message });
        });
        const who = (s: AdoState, as: unknown): AdoIdentity => {
          if (typeof as !== 'string' || !as) return findIdentity(s, s.identities[0]!.id)!;
          const i = resolveIdentity(s, as);
          if (!i) throw new AdoError(400, `Unknown identity ${as}`, 'IdentityNotFoundException');
          return i;
        };
        const summary = (s: AdoState, w: WorkItemState) => {
          const f = current(w).fields;
          const assigned = f['System.AssignedTo'] as { $identity?: string } | undefined;
          return {
            id: w.id,
            rev: current(w).rev,
            project: projectOf(s, w).name,
            type: f['System.WorkItemType'],
            title: f['System.Title'],
            state: f['System.State'],
            assignedTo: assigned?.$identity
              ? (findIdentity(s, assigned.$identity)?.uniqueName ?? null)
              : null,
            parent: current(w).relations.find((r) => r.rel === HIERARCHY_REVERSE)?.target ?? null,
            changedDate: f['System.ChangedDate'],
            deleted: w.deleted,
          };
        };

        ctl.get('/identities', async () => state().identities);

        ctl.get('/workitems', async (req: Req) => {
          const s = state();
          return Object.values(s.workItems)
            .filter((w) => !req.query.project || lower(projectOf(s, w).name) === lower(req.query.project))
            .map((w) => summary(s, w));
        });

        ctl.get('/workitems/:id', async (req: Req) => {
          const s = state();
          const w = s.workItems[String(Number(req.params.id))];
          if (!w) throw new AdoError(404, `No work item ${req.params.id}`, 'NotFound');
          return {
            ...summary(s, w),
            item: serialize(s, urls(s), w, current(w), { expand: 'relations' }),
            comments: w.comments.map((c) => serializeComment(s, urls(s), w, c, true)),
            revisions: w.revisions.length,
          };
        });

        /** Edits a work item as someone in Azure DevOps (`as`: email or unique name), like the web UI would. */
        ctl.post('/workitems/:id', async (req: Req) => {
          const s = state();
          const w = item(s, req.params.id!);
          const body = (req.body ?? {}) as {
            fields?: Record<string, unknown>;
            as?: string;
            comment?: string;
            parent?: number | null;
            /** Adds this many discussion comments at once (to reach the REST API's comment limit in tests). */
            bulkComments?: number;
          };
          const by = who(s, body.as).id;
          const ops: PatchOp[] = [];
          for (const [ref, value] of Object.entries(body.fields ?? {}))
            ops.push(
              value === null
                ? { op: 'remove', path: `/fields/${ref}` }
                : { op: 'add', path: `/fields/${ref}`, value },
            );
          if (body.parent !== undefined) {
            const index = current(w).relations.findIndex((r) => r.rel === HIERARCHY_REVERSE);
            if (index >= 0) ops.push({ op: 'remove', path: `/relations/${index}` });
            if (body.parent !== null)
              ops.push({
                op: 'add',
                path: '/relations/-',
                value: { rel: HIERARCHY_REVERSE, url: `${urls(s).api}/_apis/wit/workItems/${body.parent}` },
              });
          }
          if (ops.length) {
            const result = applyPatch(s, { project: projectOf(s, w), item: w, ops, by });
            if (result.changed) afterWrite(s, result, false, by);
          }
          if (body.comment) {
            addComment(
              s,
              w,
              `<div>${body.comment.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</div>`,
              by,
            );
            ctx.store.changed();
            fire(workItemEvent(s, urls(s), 'workitem.commented', w, by));
          }
          const bulk = Math.min(5000, Math.max(0, Math.floor(body.bulkComments ?? 0)));
          for (let i = 0; i < bulk; i++) addComment(s, w, `<div>Comment ${i + 1}</div>`, by);
          if (bulk) ctx.store.changed();
          return { ...summary(s, w), item: serialize(s, urls(s), w, current(w), { expand: 'relations' }) };
        });

        ctl.delete('/workitems/:id', async (req: Req) => {
          const s = state();
          const w = item(s, req.params.id!);
          w.deleted = true;
          ctx.store.changed();
          fire(workItemEvent(s, urls(s), 'workitem.deleted', w, who(s, (req.query as Q).as).id));
          return summary(s, w);
        });

        ctl.post('/workitems/:id/restore', async (req: Req) => {
          const s = state();
          const w = s.workItems[String(Number(req.params.id))];
          if (!w?.deleted)
            throw new AdoError(404, `Work item ${req.params.id} is not in the recycle bin`, 'NotFound');
          w.deleted = false;
          ctx.store.changed();
          fire(workItemEvent(s, urls(s), 'workitem.restored', w, who(s, undefined).id));
          return summary(s, w);
        });

        ctl.get('/repos', async () => {
          const s = state();
          return s.repos.map((r) => ({
            id: r.id,
            name: r.name,
            project: s.projects.find((p) => p.id === r.projectId)!.name,
            webUrl: repoWebUrl(s, urls(s), r),
            defaultBranch: r.defaultBranch,
            head: r.refs[r.defaultBranch],
            branches: Object.keys(r.refs).map((n) => n.replace('refs/heads/', '')),
          }));
        });

        /** Pushes one commit to a branch (the default branch unless `branch`), firing `git.push`. */
        ctl.post('/repos/:id/push', async (req: Req) => {
          const s = state();
          const r = repo(s, req.params.id!);
          const body = (req.body ?? {}) as { message?: string; as?: string; branch?: string };
          const author = who(s, body.as);
          const refName = body.branch ? `refs/heads/${body.branch}` : r.defaultBranch;
          const old = r.refs[refName] ?? r.refs[r.defaultBranch]!;
          const at = new Date().toISOString();
          const person = {
            name: author.displayName,
            email: author.mail ?? `${author.uniqueName.split('\\').at(-1)}@contoso.local`,
            date: at,
          };
          const sha = shaFrom(`${r.id}:push:${Object.keys(r.commits).length}:${at}`);
          r.commits[sha] = {
            sha,
            parents: [old],
            message: body.message ?? 'Update from the mock',
            author: person,
            committer: person,
          };
          const before = r.refs[refName] ?? '0000000000000000000000000000000000000000';
          r.refs[refName] = sha;
          ctx.store.changed();
          fire(pushEvent(s, urls(s), r, refName, before, sha, author.id));
          return { repository: r.name, ref: refName, commitId: sha };
        });

        /** Opens a pull request from `sourceBranch` (created from the default branch when missing). */
        ctl.post('/repos/:id/pullrequests', async (req: Req) => {
          const s = state();
          const r = repo(s, req.params.id!);
          const body = (req.body ?? {}) as {
            title?: string;
            sourceBranch?: string;
            targetBranch?: string;
            as?: string;
            draft?: boolean;
          };
          if (!body.title || !body.sourceBranch)
            throw new AdoError(400, 'title and sourceBranch are required', 'VssPropertyValidationException');
          const author = who(s, body.as);
          const source = `refs/heads/${body.sourceBranch}`;
          if (!r.refs[source]) r.refs[source] = r.refs[r.defaultBranch]!;
          const pr: AdoPullRequestState = {
            id: s.nextPullRequestId++,
            repoId: r.id,
            title: body.title,
            description: '',
            status: 'active',
            isDraft: Boolean(body.draft),
            createdBy: author.id,
            creationDate: new Date().toISOString(),
            sourceRefName: source,
            targetRefName: body.targetBranch ? `refs/heads/${body.targetBranch}` : r.defaultBranch,
          };
          s.pullRequests.push(pr);
          ctx.store.changed();
          fire(
            pullRequestEvent(s, urls(s), 'git.pullrequest.created', pr, {
              pullRequestId: pr.id,
              status: pr.status,
              title: pr.title,
              repository: serializeRepo(s, urls(s), r),
              sourceRefName: pr.sourceRefName,
              targetRefName: pr.targetRefName,
              createdBy: identityRef(s, urls(s), pr.createdBy),
              creationDate: pr.creationDate,
            }),
          );
          return { id: pr.id, repository: r.name, status: pr.status };
        });

        /** Changes a pull request's status (`completed`, `abandoned`, `active`), firing `git.pullrequest.updated`. */
        ctl.post('/pullrequests/:id', async (req: Req) => {
          const s = state();
          const pr = s.pullRequests.find((x) => x.id === Number(req.params.id));
          if (!pr) throw new AdoError(404, `No pull request ${req.params.id}`, 'NotFound');
          const body = (req.body ?? {}) as { status?: AdoPullRequestState['status']; title?: string };
          if (body.status) pr.status = body.status;
          if (body.title) pr.title = body.title;
          ctx.store.changed();
          const r = s.repos.find((x) => x.id === pr.repoId)!;
          fire(
            pullRequestEvent(
              s,
              urls(s),
              body.status === 'completed' ? 'git.pullrequest.merged' : 'git.pullrequest.updated',
              pr,
              {
                pullRequestId: pr.id,
                status: pr.status,
                title: pr.title,
                repository: serializeRepo(s, urls(s), r),
              },
            ),
          );
          return { id: pr.id, status: pr.status };
        });

        /** Throttles the API: `{ enabled, retryAfter?: seconds, requests?: how many to refuse (default: until off) }`. */
        ctl.post('/rate-limit', async (req: Req) => {
          const s = state();
          const body = (req.body ?? {}) as { enabled?: boolean; retryAfter?: number; requests?: number };
          s.rateLimit =
            body.enabled === false
              ? null
              : {
                  remaining: body.requests && body.requests > 0 ? body.requests : -1,
                  retryAfter: Math.max(1, Math.round(body.retryAfter ?? 30)),
                };
          ctx.store.changed();
          return { rateLimit: s.rateLimit };
        });
      },
      { prefix: '/_mock/ado' },
    );
  },
};
