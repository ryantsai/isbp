import { departments, groupMembers, groups, users, uuidv7 } from '@isbp/db/schema';
import type { ModuleContext } from '@isbp/sdk/server';
import { and, asc, count, eq, notInArray, sql } from 'drizzle-orm';
import type { ArticleStatus } from '../contracts';
import { type ArticleRow, ArticleService, indexDocument } from './articles';
import { importGuide } from './guide';
import { articles, articleVersions, categories, feedback } from './schema';
import { SEED_ARTICLES, SEED_CATEGORIES, SEED_FEEDBACK, type SeedOwner } from './seed-content';

const DAY = 86_400_000;
const ago = (days: number, now: number) => new Date(now - days * DAY);
const dateIn = (days: number, now: number) => new Date(now + days * DAY).toISOString().slice(0, 10);

/** First active member of a group (by username), so the demo is deterministic. */
async function memberOf(ctx: ModuleContext, groupKey: string, exclude: string[]) {
  const [row] = await ctx.db
    .select({ id: users.id })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(
      and(
        eq(groups.key, groupKey),
        eq(users.status, 'active'),
        exclude.length ? notInArray(users.id, exclude) : undefined,
      ),
    )
    .orderBy(asc(users.username))
    .limit(1);
  return row?.id ?? null;
}

async function userByName(ctx: ModuleContext, username: string) {
  const [row] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.username, username));
  return row?.id ?? null;
}

/** Article owners from the seeded IT staff (falls back to the admin on a bare platform). */
async function resolveOwners(ctx: ModuleContext): Promise<Record<SeedOwner, string | null>> {
  const admin = await userByName(ctx, 'admin');
  const [anyone] = await ctx.db.select({ id: users.id }).from(users).orderBy(asc(users.username)).limit(1);
  const fallback = admin ?? anyone?.id ?? null;
  const lead = (await userByName(ctx, 'helpdesk')) ?? fallback;
  const named = [lead, admin].filter((x): x is string => Boolean(x));
  const [appsPerson] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .innerJoin(departments, eq(departments.id, users.departmentId))
    .where(and(eq(departments.code, 'IT-APP'), eq(users.status, 'active')))
    .orderBy(asc(users.username))
    .limit(1);
  return {
    lead,
    servicedesk: (await memberOf(ctx, 'service-desk', named)) ?? lead,
    network: (await memberOf(ctx, 'network-team', named)) ?? fallback,
    security: (await memberOf(ctx, 'security-team', named)) ?? (await userByName(ctx, 'auditor')) ?? fallback,
    apps: appsPerson?.id ?? fallback,
  };
}

/**
 * Idempotent demo data: categories, ~20 English articles with zh-TW / ja-JP translations, every
 * lifecycle state, version history, feedback and views. Published articles are indexed directly (the
 * builtin embedder works offline) so search and the virtual agent work before the worker runs.
 */
export async function seedKnowledge(ctx: ModuleContext) {
  const svc = new ArticleService(ctx);
  // The user guide's articles (published by `importGuide`) don't count as demo data.
  const [existing] = await ctx.db
    .select({ n: count() })
    .from(articles)
    .where(sql`coalesce(${articles.source}->>'type', '') <> 'guide'`);
  if (existing!.n > 0) {
    // Already seeded: just make sure the guide and the index are current (unchanged chunks are not re-embedded).
    await importGuide(ctx);
    await svc.reindexAll();
    return;
  }

  await ctx.db
    .insert(categories)
    .values(
      SEED_CATEGORIES.map((c, i) => ({
        key: c.key,
        name: c.name,
        description: c.description,
        icon: c.icon,
        sortOrder: (i + 1) * 10,
      })),
    )
    .onConflictDoNothing();
  const catRows = await ctx.db.select().from(categories);
  const catByKey = new Map(catRows.map((c) => [c.key, c]));
  const owners = await resolveOwners(ctx);
  const now = Date.now();

  const rows: (typeof articles.$inferInsert)[] = [];
  const versions: (typeof articleVersions.$inferInsert)[] = [];
  const idBySlug = new Map<string, string>();

  SEED_ARTICLES.forEach((s, i) => {
    const status: ArticleStatus = s.status ?? 'published';
    const live = status === 'published' || status === 'retired';
    const firstPublish = s.publishedDaysAgo ?? 0;
    const prev = s.previousVersions ?? [];
    // Spread "last updated" over the past weeks so "Recently updated" looks alive.
    const updatedDaysAgo = live ? Math.min(firstPublish, 1 + ((i * 7) % 45)) : (i % 5) + 1;
    const lastPublish = prev.length ? updatedDaysAgo : firstPublish;
    const ownerId = owners[s.owner];
    const category = catByKey.get(s.category) ?? null;
    const id = uuidv7();
    idBySlug.set(s.slug, id);

    const base = {
      categoryId: category?.id ?? null,
      tags: s.tags,
      audience: s.audience ?? ('everyone' as const),
      status,
      ownerId,
      translationGroupId: id,
      reviewAt: status === 'published' && s.reviewInDays !== undefined ? dateIn(s.reviewInDays, now) : null,
    };
    rows.push({
      ...base,
      id,
      title: s.title,
      summary: s.summary,
      body: s.body,
      locale: 'en',
      publishedVersion: live ? prev.length + 1 : 0,
      publishedAt: live ? ago(lastPublish, now) : null,
      views: s.views ?? 0,
      helpfulCount: s.helpful ?? 0,
      notHelpfulCount: s.notHelpful ?? 0,
      createdAt: ago((live ? firstPublish : updatedDaysAgo) + 2, now),
      updatedAt: ago(updatedDaysAgo, now),
    });
    if (live) {
      prev.forEach((p, v) =>
        versions.push({
          articleId: id,
          version: v + 1,
          title: p.title ?? s.title,
          summary: p.summary ?? s.summary,
          body: p.body,
          publishedAt: ago(p.daysAgo, now),
          publishedBy: ownerId,
        }),
      );
      versions.push({
        articleId: id,
        version: prev.length + 1,
        title: s.title,
        summary: s.summary,
        body: s.body,
        publishedAt: ago(lastPublish, now),
        publishedBy: ownerId,
      });
    }

    // Translations go live a little after the original and are read less often.
    (s.translations ?? []).forEach((t, j) => {
      const tid = uuidv7();
      const published = Math.max(1, firstPublish - 14 - j * 9);
      rows.push({
        ...base,
        id: tid,
        title: t.title,
        summary: t.summary,
        body: t.body,
        locale: t.locale,
        publishedVersion: 1,
        publishedAt: ago(published, now),
        views: Math.round((s.views ?? 0) * (t.locale === 'zh-TW' ? 0.35 : 0.18)),
        helpfulCount: Math.round((s.helpful ?? 0) * (t.locale === 'zh-TW' ? 0.3 : 0.15)),
        notHelpfulCount: Math.round((s.notHelpful ?? 0) * 0.2),
        createdAt: ago(published + 1, now),
        updatedAt: ago(Math.min(published, updatedDaysAgo + 3), now),
      });
      versions.push({
        articleId: tid,
        version: 1,
        title: t.title,
        summary: t.summary,
        body: t.body,
        publishedAt: ago(published, now),
        publishedBy: ownerId,
      });
    });
  });

  // Readers who left the sample feedback (not article owners).
  const ownerIds = Object.values(owners).filter((x): x is string => Boolean(x));
  const readers = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.status, 'active'), ownerIds.length ? notInArray(users.id, ownerIds) : undefined))
    .orderBy(asc(users.username))
    .limit(SEED_FEEDBACK.length);

  const inserted = await ctx.transaction(async (tx) => {
    const created = await tx.insert(articles).values(rows).returning();
    if (versions.length) await tx.insert(articleVersions).values(versions);
    const votes = SEED_FEEDBACK.flatMap((f, i) => {
      const articleId = idBySlug.get(f.slug);
      const reader = readers[i % Math.max(1, readers.length)];
      return articleId && reader
        ? [
            {
              articleId,
              userId: reader.id,
              helpful: f.helpful,
              comment: f.comment ?? null,
              createdAt: ago(1 + (i % 9), now),
            },
          ]
        : [];
    });
    if (votes.length) await tx.insert(feedback).values(votes).onConflictDoNothing();
    return created;
  });

  // Index directly so retrieval works on first run (the worker may not have processed any event yet).
  const catById = new Map(catRows.map((c) => [c.id, c]));
  const published = inserted.filter((a: ArticleRow) => a.status === 'published');
  for (const a of published)
    await ctx.ai.index.upsert(indexDocument(a, a.categoryId ? (catById.get(a.categoryId) ?? null) : null));
  ctx.logger.info({ articles: inserted.length, indexed: published.length }, 'knowledge demo data seeded');

  // The user guide after the demo articles, so their numbers (KB-00001…) don't depend on the guide.
  if (await importGuide(ctx)) await svc.reindexAll();
}
