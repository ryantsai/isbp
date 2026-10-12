import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEED_ARTICLES } from '@isbp/module-knowledge/seed-content';
import type { AuthContext } from '@isbp/sdk/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type EvalCase, evaluate, formatReport } from '../../src/kernel/ai/evaluation';
import { buildAuthContext } from '../../src/kernel/http/auth';
import { createHarness, type Harness } from './harness';

/**
 * Search quality on our own content and languages, with the builtin embedder (no model, no network): the demo
 * knowledge base and paraphrased questions in English, Traditional Chinese and Japanese
 * (`test/fixtures/retrieval-eval.json`). The floors catch regressions in chunking, terms and fusion; raise them
 * when search gets better. `pnpm ai:eval` runs the same questions against a live index and its configured models.
 */
const TYPE = 'eval.article';
const { cases } = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'retrieval-eval.json'), 'utf8'),
) as { cases: EvalCase[] };

let h: Harness;
let auth: AuthContext;

beforeAll(async () => {
  h = await createHarness();
  const permissions = await h.kernel.rbac.permissionsFor(h.ids.admin);
  auth = buildAuthContext({ type: 'user', id: h.ids.admin, name: 'Admin' }, null, null, permissions);
  const index = h.kernel.registry.context('core').ai.index;
  // Only what people can find: drafts, articles in review and retired ones are never in the index.
  for (const a of SEED_ARTICLES.filter((x) => !x.status || x.status === 'published')) {
    for (const v of [
      { locale: 'en', title: a.title, summary: a.summary, body: a.body },
      ...(a.translations ?? []),
    ])
      await index.upsert({
        type: TYPE,
        id: `${a.slug}:${v.locale}`,
        title: v.title,
        text: `${v.summary}\n\n${v.body}`,
        locale: v.locale,
        acl: { permission: 'core.users.read' },
        metadata: { slug: a.slug },
      });
  }
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe('retrieval evaluation (builtin embedder, demo knowledge base)', () => {
  it('finds the right article for paraphrased questions in en, zh-TW and ja-JP', async () => {
    const index = h.kernel.registry.context('core').ai.index;
    const report = await evaluate(cases, async (c) => {
      const hits = await index.search(c.q, { types: [TYPE], auth, limit: 10 });
      return [...new Set(hits.map((x) => String(x.metadata.slug)))];
    });
    console.warn(`\n${formatReport(report)}\n`);
    expect(report.overall.recallAt5).toBeGreaterThanOrEqual(0.9);
    expect(report.overall.mrr).toBeGreaterThanOrEqual(0.8);
    for (const [locale, s] of Object.entries(report.byLocale))
      expect(s.recallAt5, `${locale} recall@5`).toBeGreaterThanOrEqual(0.85);
  }, 120_000);
});
