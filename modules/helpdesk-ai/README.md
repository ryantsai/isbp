# Helpdesk AI module

AI on the service desk (architecture §9.5): triage on create, similar tickets and suggested articles,
KB-grounded reply drafts with citations, ticket summaries, KB drafts from resolved tickets, the
self-service virtual agent ("Ask IT") and accuracy / deflection / cost metrics.

Every feature has a **builtin mode** (retrieval, votes, templates) used when no chat model is configured,
and an **LLM mode** through the kernel AI gateway (`ctx.ai`). The UI always says which one answered.

ITSM and the knowledge base are reached **only** through the AI tool registry
(`ctx.ai.tools.invoke`): as the signed-in user for interactive features, or as the module's agent
identity (`manifest.ai.agent`: read tickets and articles, set triage fields) for background triage.

| File                     | What it does                                                                      |
| ------------------------ | --------------------------------------------------------------------------------- |
| `src/manifest.ts`        | Permissions, roles, settings, events, navigation and the agent identity           |
| `src/contracts.ts`       | Zod DTOs and the SSE event types shared by routes and pages                       |
| `src/lib/*`              | Pure logic: triage vote, keywords, Markdown steps, citations, SSE, history        |
| `src/server/assist.ts`   | Triage, assist panel data, reply drafts, summaries, KB drafts, feedback           |
| `src/server/chat.ts`     | The virtual agent: conversations, streamed turns, bounded tool loop, escalation   |
| `src/server/insights.ts` | The metrics overview (triage acceptance, deflection, usage and cost per feature)  |
| `src/server/text.ts`     | Server-side texts from the catalogs (`server.*`) in en / zh-TW / ja-JP            |
| `src/web/assist/*`       | `itsm.ticket.aside` slot: the AI assist panel                                     |
| `src/web/chat/*`         | `ChatPanel` (page and sheet), the "Ask IT" card for the portal and knowledge home |
| `src/web/pages/*`        | `/helpdesk-ai` (insights), `/helpdesk-ai/chat`, `/helpdesk-ai/conversations/:id`  |

```bash
pnpm --filter @isbp/module-helpdesk-ai db:generate   # after changing src/server/schema.ts
pnpm --filter @isbp/module-helpdesk-ai test
```
