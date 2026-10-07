# Knowledge module

Knowledge Base for agents and self-service: articles in Markdown (en, zh-TW, ja-JP, linked as
translations), categories, a `draft → in_review → published → retired` lifecycle with a version per
publish, an optional `knowledge.publish` approval workflow, review dates with reminders, reader
feedback, and hybrid semantic search through the shared AI index (`ctx.ai.index`).

| File                       | What it does                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `src/manifest.ts`          | Permissions, roles, events, workflow trigger, notifications, AI tools, portal entry |
| `src/contracts.ts`         | Zod DTOs, references (`KB-00042`), AI tool inputs, `KnowledgeHomeAssistSlotProps`   |
| `src/lifecycle.ts`         | Pure status-transition, visibility and edit rules (shared by API and tests)         |
| `src/rank.ts`              | Article-level re-ranking of index hits (vector + keyword, Reciprocal Rank Fusion)   |
| `src/server/articles.ts`   | Article service: lifecycle, versions, feedback, search, index sync, AI tool shapes  |
| `src/server/categories.ts` | Category tree with published-article counts                                         |
| `src/server/routes.ts`     | REST API under `/api/v1/knowledge`                                                  |
| `src/server/index.ts`      | Event handlers (index sync), jobs, AI tools, global search, seed                    |
| `src/server/seed*.ts`      | Demo categories and ~30 real help-desk articles, indexed directly                   |
| `src/web/pages/*`          | Home (search + `knowledge.home.assist` slot), article, manage, editor, categories   |

**Sync (Phase 5).** `src/server/sync.ts` adapts `knowledge.article` for the Integrations Hub (matched on title;
permission `knowledge.articles.sync`). The hub's agent acts as the author of what it syncs: it creates and edits
drafts and submits or withdraws them. Publishing (a new version), retiring, restoring and editing a live article
need the agent's own `knowledge.articles.publish` (403 otherwise), and a running review workflow decides alone
(409 `INVALID_TRANSITION`, `reason: 'approval_required'`). Created articles say where they came from
(`source.type: 'integration'`).

AI tools used by Helpdesk AI: `knowledge.search_articles`, `knowledge.get_article`,
`knowledge.create_draft` (see `src/contracts.ts` for the exact input and output shapes).

```bash
pnpm --filter @isbp/module-knowledge db:generate   # after changing src/server/schema.ts
pnpm --filter @isbp/module-knowledge test
```
