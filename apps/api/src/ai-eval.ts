/**
 * `pnpm ai:eval`: runs the labelled questions (`test/fixtures/retrieval-eval.json`) through the knowledge base's
 * search (what Ask IS uses) on a seeded demo, with the embedder and reranker configured in Administration → AI, and
 * prints recall@1, recall@5 and MRR per language. Compare models on our own content before switching them:
 *
 *   pnpm ai:eval                 # as the demo admin
 *   pnpm ai:eval -- --user jane  # as another user (what they may read)
 *
 * A changed embedding model is re-embedded in the background: wait for Administration → AI → Index to show no
 * stale documents before comparing.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { users } from '@isbp/db/schema';
import { SEED_ARTICLES } from '@isbp/module-knowledge/seed-content';
import { eq } from 'drizzle-orm';
import { bootstrap } from './bootstrap';
import { type EvalCase, evaluate, formatReport } from './kernel/ai/evaluation';
import { buildAuthContext } from './kernel/http/auth';

const args = process.argv.slice(2);
const userFlag = args.indexOf('--user');
const username = (userFlag >= 0 ? args[userFlag + 1] : undefined) ?? 'admin';
const here = dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(
  readFileSync(join(here, '..', 'test', 'fixtures', 'retrieval-eval.json'), 'utf8'),
) as { cases: EvalCase[] };

// Hits carry the article's title: map every language version's title to its slug.
const slugOf = new Map<string, string>();
for (const a of SEED_ARTICLES) {
  slugOf.set(a.title, a.slug);
  for (const t of a.translations ?? []) slugOf.set(t.title, a.slug);
}

const { kernel } = await bootstrap('isbp-ai-eval');
try {
  const [user] = await kernel.db.select().from(users).where(eq(users.username, username)).limit(1);
  if (!user) throw new Error(`No user "${username}": seed the demo first (pnpm db:seed)`);
  const auth = buildAuthContext(
    { type: 'user', id: user.id, name: user.displayName },
    null,
    null,
    await kernel.rbac.permissionsFor(user.id),
  );
  const status = await kernel.ai.status();
  const config = await kernel.ai.config();
  console.warn(
    `Embeddings: ${status.embeddings.model} (${status.embeddings.dimensions} dimensions) · reranker: ${
      config.rerank.provider === 'none' ? 'none' : `${config.rerank.provider} ${config.rerank.model}`
    } · vector store: ${status.vectorStore} · as ${username}\n`,
  );
  // What Ask IS and the knowledge base search see: the knowledge module's own ranking over the index.
  const ai = kernel.registry.context('core').ai;
  const report = await evaluate(cases, async (c) => {
    const out = await ai.tools.invoke<{ items: { title: string }[] }>(
      'knowledge.search_articles',
      { query: c.q, limit: 10, locale: c.locale },
      { auth },
    );
    return [...new Set(out.items.map((x) => slugOf.get(x.title) ?? x.title))];
  });
  console.warn(formatReport(report));
} finally {
  await kernel.close();
}
