# Knowledge module

Knowledge Base for agents and self-service: articles in Markdown (en, zh-TW, ja-JP, linked as
translations), categories, a `draft → in_review → published → retired` lifecycle with a version per
publish, an optional `knowledge.publish` approval workflow, review dates with reminders, reader
feedback, and hybrid semantic search through the shared AI index (`ctx.ai.index`). Published articles index their
attachments too (`attachments: true`): text found in a PDF or Office file brings up the article, and search results
say which file and page (`attachment` on article cards and on the `knowledge.search_articles` tool).

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

**Classification (Phase 8).** Articles carry an optional classification label (`articles.classification`): one of
the labels in the module setting `classification.levels` (one per line, most restrictive first; default the built-in
`strictly-confidential`, `customer-confidential`, `confidential`, `internal-use-only`, translated in the catalog under
`classificationLevel`; any other line is a custom label shown as written). `GET /classifications` lists them; create
and update refuse other values (400). The label shows as a badge (tone by rank) and a handling banner on the article,
in lists and search results and in the editor, filters lists (`?classification=<key>|none`) and is the record fact
`classification` of `knowledge.article`. It doesn't change who may read the article (that is the audience).

**Attachments (Phase 8).** The article page hosts the core files panel (`core.record.files`) for people who may edit
the article, and for readers when the article has attachments (`attachments` on the DTO). The record resolver's
`editable` follows `canEdit`, so editors (and authors of their drafts) add and remove files, and links, while
everyone who can read the article downloads them; files of drafts and internal articles stay hidden from readers.

**Sync (Phase 5).** `src/server/sync.ts` adapts `knowledge.article` for the Integrations Hub (matched on title;
permission `knowledge.articles.sync`). The hub's agent acts as the author of what it syncs: it creates and edits
drafts and submits or withdraws them. Publishing (a new version), retiring, restoring and editing a live article
need the agent's own `knowledge.articles.publish` (403 otherwise), and a running review workflow decides alone
(409 `INVALID_TRANSITION`, `reason: 'approval_required'`). Created articles say where they came from
(`source.type: 'integration'`).

**Authoring.** A new article without a `locale` is in the author's language (their profile; a translation takes the
first language its group lacks), also through `knowledge.create_draft`. What "submit" does for the caller is
`submitOutcome` on a draft's DTO and `GET /articles/submit-outcome?audience=&locale=&categoryId=` for an unsaved form:
`publish` (they publish and no approval workflow applies), `review` (an editor publishes) or `approval` (the bound
`knowledge.publish` workflow decides, from a dry run with `ctx.workflows.preview`); the editor's button says "Publish"
or "Submit for review" from it. `GET /articles/counts` gives the management tabs their counts (same filters as the
list). Lifecycle actions re-check the article under a row lock inside their transaction, so two requests at once
change it once (the other gets 409 `INVALID_TRANSITION`).

**Web.** Knowledge home, Manage and Categories share section tabs (`KnowledgeSections`, only for writers and category
managers). The article page uses `DetailHeader` (next lifecycle step as the primary action, Edit/Translate/History,
Retire and Delete under "More"); readers who answer "No" to "Was this helpful?" get "Ask IT" and "Report an issue"
when they can use them. The editor keeps title, summary, body (formatting toolbar: `src/web/markdown-format.ts`, pure
and unit-tested), category and audience in view, and the rest under "More settings".

AI tools used by Helpdesk AI and ITSM: `knowledge.search_articles`, `knowledge.get_article`,
`knowledge.create_draft` (see `src/contracts.ts` for the exact input and output shapes). A draft written for a
ticket or a problem carries `source: { type: 'itsm.ticket' | 'itsm.problem', id, reference: 'INC-…' | 'PRB-…' }`
(shown as "Based on PRB-00012", linked to the ticket) and is finished in the editor at `/knowledge/<reference>/edit` (the tool returns `href`; append
`/edit`).

```bash
pnpm --filter @isbp/module-knowledge db:generate   # after changing src/server/schema.ts
pnpm --filter @isbp/module-knowledge test
```
