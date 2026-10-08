# Assistant (`assistant`)

The platform's built-in AI agent and its **change sets**. Design: `docs/architecture.md` §13.

- **The agent** is a panel on every page (shell slot `core.shell.header`). It knows the page and the record on it,
  and works through the platform's own MCP tools in-process (`ctx.ai.mcp`), as the signed-in person: everyday work
  (tickets, comments, tasks, drafts) directly, configuration as change sets. Destructive tools — applying or rolling
  back a change set, any module tool marked `destructive` — become a confirmation card and run only when the person
  confirms. Without a chat model, the panel offers the kinds' guided templates instead.
- **Change sets** collect proposed changes to **customisation kinds** (`ctx.customizations`: approval workflows,
  forms, custom fields, roles, scheduled jobs, sync profiles, …, each owned by its module). After every edit the whole
  set is dry-run in a transaction that is rolled back. Applying is one transaction by someone holding every kind's
  apply permission (on the change set page, or by confirming the agent's request); a review runs the
  `assistant.change-set` workflow and applies the set as the approver. Rollback is one transaction too.

This module never writes another module's tables: every change goes through the owning module's kind.

## Files

| File                        | What it does                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/manifest.ts`           | Permissions, roles, the `assistant.change-set` review trigger (default: a platform administrator), notifications, AI tools                |
| `src/contracts.ts`          | DTOs and inputs (change sets, items, dry-run results, conversations, confirmations, stream events)                                        |
| `src/tool-inputs.ts`        | Inputs of the AI tools (web-safe: the manifest imports them)                                                                              |
| `src/lib/refs.ts`           | `"$ref:<name>"` references between items, labels (pure)                                                                                   |
| `src/server/change-sets.ts` | `ChangeSetService`: propose, dry run, apply, review (`onReviewCompleted` applies as the approver), rollback, refresh, discard, visibility |
| `src/server/chat.ts`        | `ChatService`: conversations, the streamed tool loop on `ctx.ai.mcp`, confirmations                                                       |
| `src/server/tools.ts`       | The AI tools (`assistant.*`), shared by the agent and outside MCP clients                                                                 |
| `src/server/routes.ts`      | REST API under `/api/v1/assistant` (status, conversations with SSE, change sets, templates)                                               |
| `src/web/panel/*`           | The header button and side panel: thread, tool chips, change set card, confirmation cards, guided templates                               |
| `src/web/pages/*`           | Change sets (`/assistant/change-sets`) and a change set's page with diffs, dry runs and previews                                          |
| `src/web/change-set/*`      | Item cards, the structured JSON diff, action dialogs                                                                                      |

## Tables (schema `assistant`)

| Table              | Notes                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `change_sets`      | `CS-n`, title, summary, status (`draft`, `in_review`, `applied`, `rolled_back`, `discarded`), creator (a person or an API client), review instance, applied / rolled back by, `last_error` |
| `change_set_items` | position, `ref`, kind, op, target, value, base version, latest dry run (`check`), applied id, before / after snapshots                                                                     |
| `conversations`    | a person's conversation and its current change set                                                                                                                                         |
| `messages`         | turns as `AiMessage` (native provider content kept), the page of each user turn, confirmations on tool turns                                                                               |

## Rules

- Proposing needs `assistant.agent.use` and the kind's read permission; applying and rolling back need every kind's
  apply permission (the kernel checks) and `confirm: true` when the set archives or deletes something.
- Base versions (hashes of each object's value) are captured when proposing; applying refuses `CHANGE_SET_STALE`
  until the change set is refreshed. Rollback refuses when an object changed after the apply.
- A change set is visible to its creator, to holders of `assistant.change-sets.read`, and to the approvers of its
  review.
- Applying after an approved review runs as the deciding approver (`ctx.rbac.authFor`); if that fails, or the
  decision was automatic, the set returns to draft with the error and the creator is notified.
- Conversation tools act on the conversation's change set (its id is filled in); a pending confirmation expires when
  the person sends another message.

## API, events and tools

- Routes: `GET /status`, `/conversations` (+ `/{id}`, `/{id}/messages` SSE, `/{id}/confirmations/{toolCallId}`),
  `/change-sets` (+ `/{id}`, `/items`, `/check`, `/refresh`, `/apply`, `/submit`, `/withdraw`, `/rollback`,
  `/discard`), `/templates/{kind}/{templateId}`, `/templates/build`.
- Events: `assistant.change-set.created`, `.submitted`, `.applied`, `.returned`, `.rolled_back`, `.discarded`.
- Tools: `list_kinds`, `describe_kind`, `list_objects`, `get_object`, `propose_change`, `remove_change`,
  `get_change_set`, `update_change_set`, `request_review`, and the destructive `apply_change_set` and
  `rollback_change_set` (never offered over MCP).

```bash
pnpm --filter @isbp/module-assistant db:generate   # after changing src/server/schema.ts
pnpm --filter @isbp/module-assistant test
```
