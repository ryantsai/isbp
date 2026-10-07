/**
 * Sync adapter (Phase 5): `alm.repository` (inside an application), so the Integrations Hub can keep
 * repositories in step with the Git server (Azure DevOps Server) without this module knowing it: default
 * branch, last commit, branches and active pull requests — the application page's "Git status". Pull-only
 * in practice, but writes are generic and go through `ApplicationService` like the settings tab's.
 */
import {
  type DomainEvent,
  ErrorCodes,
  HttpError,
  type ModuleContext,
  type SyncAdapter,
  type SyncFieldDef,
  type SyncRecord,
} from '@isbp/sdk/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  createRepositorySchema,
  gitStatusSchema,
  REPO_PROVIDERS,
  updateRepositorySchema,
} from '../contracts';
import { appHref } from '../model';
import type { RepoRow } from './refs';
import { applications, repositories } from './schema';
import { services } from './services';
import {
  cursorAt,
  inSyncWrite,
  invalidValues,
  isUuid,
  pageLimit,
  pageOf,
  pageOrder,
  pageWhere,
  parseInput,
  syncErrors,
  writerAuth,
} from './sync-support';

type Values = Record<string, unknown>;

/** What `alm.repositories.sync` stands for (the kernel checked it). */
const WRITER = ['alm.apps.read', 'alm.apps.manage'];

const FIELDS = [
  'name',
  'url',
  'provider',
  'defaultBranch',
  'lastCommitSha',
  'lastCommitAt',
  'lastCommitMessage',
  'lastCommitAuthor',
] as const;

const label = (key: string) => `alm.sync.fields.${key}`;

const columns = { r: repositories, code: applications.code };

function record({ r, code }: { r: RepoRow; code: string }): SyncRecord {
  return {
    id: r.id,
    ref: `${code}/${r.name}`,
    title: r.name,
    href: appHref(code),
    updatedAt: r.updatedAt.toISOString(),
    containerId: r.applicationId,
    values: {
      name: r.name,
      url: r.url,
      provider: r.provider,
      defaultBranch: r.defaultBranch,
      lastCommitSha: r.lastCommitSha,
      lastCommitAt: r.lastCommitAt?.toISOString() ?? null,
      lastCommitMessage: r.lastCommitMessage,
      lastCommitAuthor: r.lastCommitAuthor,
      branches: r.branches ?? null,
      pullRequests: r.pullRequests ?? null,
    },
  };
}

const select = (ctx: ModuleContext) =>
  ctx.db
    .select(columns)
    .from(repositories)
    .innerJoin(applications, eq(applications.id, repositories.applicationId));

/** Sync values in the shape of the module's repository schemas (required texts can't be emptied). */
function repositoryFields(v: Values): Values {
  const cleared = (['name', 'url', 'provider'] as const).filter((k) => v[k] === null);
  if (cleared.length) throw invalidValues(cleared.map((path) => ({ path, message: 'required' })));
  const out: Values = {};
  for (const k of FIELDS) if (k in v) out[k] = v[k];
  // An empty repository has no default branch yet: keep the one on record (`main` for a new one).
  if (out.defaultBranch === null || (typeof out.defaultBranch === 'string' && !out.defaultBranch.trim()))
    delete out.defaultBranch;
  if (typeof out.lastCommitAt === 'string') out.lastCommitAt = new Date(out.lastCommitAt).toISOString();
  return out;
}

/** Branches and pull requests, checked against their shapes (`[]` and null both mean "none known"). */
function gitStatus(v: Values) {
  const input: Values = {};
  if ('branches' in v) input.branches = v.branches;
  if ('pullRequests' in v) input.pullRequests = v.pullRequests;
  return parseInput(gitStatusSchema, input, { branches: 'branches', pullRequests: 'pullRequests' });
}

export const repositoryAdapter: SyncAdapter = {
  matchKeys: ['url'],

  async fields(): Promise<SyncFieldDef[]> {
    return [
      { key: 'name', label: label('name'), type: 'string', required: true, maxLength: 200 },
      { key: 'url', label: label('url'), type: 'string', required: true, maxLength: 500 },
      {
        key: 'provider',
        label: label('provider'),
        type: 'choice',
        choices: REPO_PROVIDERS.map((p) => ({ value: p, label: `alm.provider.${p}` })),
      },
      { key: 'defaultBranch', label: label('defaultBranch'), type: 'string', maxLength: 200 },
      { key: 'lastCommitSha', label: label('lastCommitSha'), type: 'string', maxLength: 64 },
      { key: 'lastCommitAt', label: label('lastCommitAt'), type: 'datetime' },
      { key: 'lastCommitMessage', label: label('lastCommitMessage'), type: 'text', maxLength: 2_000 },
      { key: 'lastCommitAuthor', label: label('lastCommitAuthor'), type: 'string', maxLength: 200 },
      { key: 'branches', label: label('branches'), type: 'json' },
      { key: 'pullRequests', label: label('pullRequests'), type: 'json' },
    ];
  },

  async read(id, ctx) {
    if (!isUuid(id)) return null;
    const [row] = await select(ctx).where(eq(repositories.id, id));
    return row ? record(row) : null;
  },

  async readMany(ids, ctx) {
    const valid = ids.filter(isUuid);
    if (!valid.length) return [];
    return (await select(ctx).where(inArray(repositories.id, valid))).map(record);
  },

  async list(opts, ctx) {
    const limit = pageLimit(opts.limit);
    if (opts.containerId && !isUuid(opts.containerId)) return { items: [], next: null };
    const rows = await ctx.db
      .select({ ...columns, cursorAt: cursorAt(repositories.updatedAt) })
      .from(repositories)
      .innerJoin(applications, eq(applications.id, repositories.applicationId))
      .where(
        and(
          opts.containerId ? eq(repositories.applicationId, opts.containerId) : undefined,
          pageWhere(repositories.updatedAt, repositories.id, opts),
        ),
      )
      .orderBy(...pageOrder(repositories.updatedAt, repositories.id))
      .limit(limit + 1);
    const page = pageOf(
      rows.map((r) => ({ ...r, id: r.r.id })),
      limit,
    );
    return { items: page.rows.map(record), next: page.next };
  },

  /** Case-insensitive URL, a trailing slash aside; within the application when given; null if ambiguous. */
  async findBy(field, value, opts, ctx) {
    if (field !== 'url' || typeof value !== 'string' || !value.trim()) return null;
    if (opts.containerId && !isUuid(opts.containerId)) return null;
    const rows = await select(ctx)
      .where(
        and(
          sql`lower(rtrim(${repositories.url}, '/')) = lower(rtrim(${value.trim()}, '/'))`,
          opts.containerId ? eq(repositories.applicationId, opts.containerId) : undefined,
        ),
      )
      .limit(2);
    return rows.length === 1 ? record(rows[0]!) : null;
  },

  write(input, opts, ctx) {
    return inSyncWrite(ctx, opts, async (bound) => {
      const v: Values = { ...input.values };
      const auth = writerAuth(opts.auth, WRITER);
      const s = services(bound).apps;
      const fields = repositoryFields(v);
      const git = gitStatus(v);
      return syncErrors({}, async () => {
        if (!input.id) {
          if (
            !isUuid(input.containerId) ||
            !(await bound.db.$count(applications, eq(applications.id, input.containerId)))
          )
            throw invalidValues([{ path: 'containerId', message: 'unknown application' }]);
          const created = await s.createRepository(
            input.containerId,
            { ...parseInput(createRepositorySchema, fields, {}), ...git },
            auth,
          );
          return { id: created.id };
        }
        const [before] = isUuid(input.id)
          ? await bound.db.select().from(repositories).where(eq(repositories.id, input.id))
          : [];
        if (!before) throw new HttpError(404, ErrorCodes.NOT_FOUND, 'Repository not found');
        if (input.containerId && input.containerId !== before.applicationId)
          throw new HttpError(409, ErrorCodes.INVALID_STATE, 'A repository stays in its application', {
            reason: 'other_application',
          });
        await s.updateRepository(
          before.applicationId,
          before.id,
          { ...parseInput(updateRepositorySchema, fields, {}), ...git },
          auth,
        );
        return { id: before.id };
      });
    });
  },

  idFromEvent(event: DomainEvent) {
    const id = (event.payload as { repositoryId?: unknown }).repositoryId;
    return isUuid(id) ? id : null;
  },
};

export const sync = { repository: repositoryAdapter };
