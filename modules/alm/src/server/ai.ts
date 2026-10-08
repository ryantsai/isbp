import { type AiToolHandler, httpErrors } from '@isbp/sdk/server';
import { asc, desc, eq } from 'drizzle-orm';
import {
  aiFindApplicationsInput,
  aiGetApplicationInput,
  aiRecordDeploymentInput,
  aiReleaseReadinessInput,
} from '../contracts';
import { appHref, releaseHref } from '../model';
import type { AppSummaryOut } from './refs';
import { releases } from './schema';
import { services } from './services';

/** Plain values a model can quote, plus a link for the UI. */
const compactApp = (a: AppSummaryOut) => ({
  code: a.code,
  name: a.name,
  stage: a.stage,
  criticality: a.criticality,
  hosting: a.hosting,
  businessOwner: a.businessOwner?.displayName ?? null,
  technicalOwner: a.technicalOwner?.displayName ?? null,
  team: a.team?.name ?? null,
  productionVersion: a.productionVersion,
  lastDeployment: a.lastDeployment && {
    environment: a.lastDeployment.environment.name,
    version: a.lastDeployment.version,
    status: a.lastDeployment.status,
    at: a.lastDeployment.at.toISOString(),
  },
  href: appHref(a.code),
});

const CHECK_LABELS = {
  change: 'An authorized (CAB-approved) change is linked',
  tested: 'The version succeeded in test or staging',
  notes: 'Release notes are written',
  production: 'No production deployment of this version failed',
} as const;

/** Handlers of `manifest.ai.tools` (input already validated against the manifest schemas). */
export const aiTools: Record<string, AiToolHandler> = {
  'alm.find_applications': async (input, ctx, auth) => {
    const { query, stage, limit } = aiFindApplicationsInput.parse(input);
    const page = await services(ctx).apps.list(
      { page: 1, pageSize: limit, q: query || undefined, stage: stage ? [stage] : undefined },
      auth,
    );
    return { total: page.total, applications: page.items.map(compactApp) };
  },

  'alm.get_application': async (input, ctx, auth) => {
    const { code } = aiGetApplicationInput.parse(input);
    const s = services(ctx);
    const app = await s.apps.detail(code, auth);
    const latest = await ctx.db
      .select()
      .from(releases)
      .where(eq(releases.applicationId, app.id))
      .orderBy(desc(releases.createdAt), asc(releases.version))
      .limit(5);
    return {
      ...compactApp(app),
      description: app.description,
      supportGroup: app.supportGroup?.name ?? null,
      department: app.department?.name ?? null,
      disposition: app.disposition,
      vendor: app.vendor,
      techStack: app.techStack,
      dataClassification: app.dataClassification,
      goLiveDate: app.goLiveDate,
      retireDate: app.retireDate,
      configurationItem: app.ci && {
        reference: app.ci.reference,
        name: app.ci.name,
        href: `/cmdb/${app.ci.reference}`,
      },
      environments: app.environments.map((e) => ({
        name: e.name,
        kind: e.kind,
        url: e.url,
        currentVersion: e.currentVersion,
        lastDeployment: e.lastDeployment && {
          version: e.lastDeployment.version,
          status: e.lastDeployment.status,
          at: e.lastDeployment.at.toISOString(),
        },
      })),
      repositories: app.repositories.map((r) => ({
        name: r.name,
        url: r.url,
        defaultBranch: r.defaultBranch,
      })),
      latestReleases: latest.map((r) => ({
        version: r.version,
        name: r.name,
        status: r.status,
        plannedDate: r.plannedDate,
        releasedAt: r.releasedAt?.toISOString() ?? null,
        href: releaseHref(app.code, r.version),
      })),
    };
  },

  'alm.release_readiness': async (input, ctx, auth) => {
    const { application, version } = aiReleaseReadinessInput.parse(input);
    const s = services(ctx);
    const app = await s.apps.resolve(application);
    const release = await s.releases.byVersion(app.id, version);
    if (!release) throw httpErrors.notFound(`${app.code} has no release ${version}`);
    const r = await s.releases.readiness(release.id, auth);
    const change = (c: NonNullable<typeof r.change>) => ({
      reference: c.reference,
      title: c.title,
      status: c.status,
      authorized: c.authorized,
      plannedStart: c.plannedStart?.toISOString() ?? null,
      plannedEnd: c.plannedEnd?.toISOString() ?? null,
      inWindow: c.inWindow,
    });
    return {
      application: app.code,
      version: release.version,
      status: release.status,
      ready: r.ready,
      passed: `${r.passed}/${r.total}`,
      checks: r.checks.map((c) => ({ check: CHECK_LABELS[c.key], ok: c.ok })),
      testedIn: r.testedIn,
      linkedChanges: r.changes.map(change),
      productionPolicy: r.policy.production && {
        outcome: r.policy.production.outcome,
        reason: r.policy.production.reason,
        warning: r.policy.production.warning,
        change: r.policy.production.change && change(r.policy.production.change),
      },
      raiseChangeHref: r.raiseChangeHref,
      href: releaseHref(app.code, release.version),
    };
  },

  'alm.record_deployment': async (input, ctx, auth) => {
    const v = aiRecordDeploymentInput.parse(input);
    const recorded = await services(ctx).deployments.record(
      {
        application: v.application,
        environment: v.environment,
        version: v.version,
        status: v.status,
        changeReference: v.changeReference ?? null,
        notes: v.notes ?? null,
      },
      auth,
      { allowOverride: false },
    );
    const d = recorded;
    return {
      id: d.id,
      application: d.application.code,
      environment: d.environment.name,
      version: d.version,
      status: d.status,
      release: d.release?.version ?? null,
      change: d.change?.reference ?? null,
      policy: d.policy,
      href: d.release
        ? releaseHref(d.application.code, d.version)
        : `${appHref(d.application.code)}?tab=deployments`,
    };
  },
};
