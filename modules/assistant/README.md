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

- **Links** (Phase 8): once a change set is applied, what it made shows where people use it (a form's own page,
  "Open the form"), from the kinds' `links`: on the change set page (**Ready to use**), in the panel's card, in the
  agent's reply after the person confirms, in the tools' results for the model, and in the conversation when a review
  applies the set. A guided template may build several changes that refer to each other (core's "Request process":
  a workflow, then the form using it); they are proposed in order into one change set, refs renamed when taken.

- **Packages** (Phase 8): a change set as a file (`isbp.change-set-package`, version 1). **Export** downloads one;
  **import** (a file) and **install** (a module's built-in package, `manifest.customizationPackages`) create a draft
  change set from one, checking every item as a proposal and creating nothing when one fails, then dry-run it once.
  **Process packs** (`/assistant/packs`; **Install a process pack** on Change sets and on Administration → Forms,
  slot `core.forms.header`) lists the built-in packages with what each creates, by process, before installing
  (`GET /packages/{module}/{key}`), and imports files.

- **Reading a change set** (UX): items are grouped by process (`src/lib/processes.ts`: a request form with its
  workflow, the groups only it uses and the schedules that assign it; what several processes share; the rest), each
  described in plain sentences per kind (`src/web/change-set/describe.tsx`: questions, audience, who approves, what
  happens after), with ids, properties and JSON under **Technical details**. Long sets start collapsed with an
  outline. Removing a change offers to remove what depends on it (`?withDependents=true`). Permission codes in
  messages read as the roles that grant them (`permissionRoles`). After applying, **Next steps** lists the new groups
  to fill.

This module never writes another module's tables: every change goes through the owning module's kind.

## Files

| File                        | What it does                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/manifest.ts`           | Permissions, roles, the `assistant.change-set` review trigger (default: a platform administrator), notifications, AI tools                                         |
| `src/contracts.ts`          | DTOs and inputs (change sets, items, dry-run results, conversations, confirmations, stream events)                                                                 |
| `src/tool-inputs.ts`        | Inputs of the AI tools (web-safe: the manifest imports them)                                                                                                       |
| `src/lib/refs.ts`           | `"$ref:<name>"` references between items (resolving, renaming), labels (pure)                                                                                      |
| `src/lib/links.ts`          | The links of what an applied change set made (pure; server and web)                                                                                                |
| `src/lib/packages.ts`       | Packages: `packageOf` (export), `packageIssues` and `proposalProblems` (the checks an import shares with proposing); exported as `@isbp/module-assistant/packages` |
| `src/lib/processes.ts`      | How items hang together (pure): references by `$ref` and by key, dependents, grouping by process, counts by kind                                                   |
| `src/server/turns.ts`       | Appending turns to a conversation (the chat, and a review's note)                                                                                                  |
| `src/server/change-sets.ts` | `ChangeSetService`: propose, dry run, apply, review (`onReviewCompleted` applies as the approver), rollback, refresh, discard, visibility                          |
| `src/server/chat.ts`        | `ChatService`: conversations, the streamed tool loop on `ctx.ai.mcp`, confirmations                                                                                |
| `src/server/tools.ts`       | The AI tools (`assistant.*`), shared by the agent and outside MCP clients                                                                                          |
| `src/server/routes.ts`      | REST API under `/api/v1/assistant` (status, conversations with SSE, change sets, templates)                                                                        |
| `src/web/panel/*`           | The header button and side panel: thread, tool chips, change set card, confirmation cards, guided templates                                                        |
| `src/web/pages/*`           | Change sets (`/assistant/change-sets`), a change set's page (grouped by process, previews, Technical details), Process packs (`/assistant/packs`)                  |
| `src/web/change-set/*`      | Item cards, plain-sentence descriptions, permission names, the structured JSON diff, action dialogs                                                                |
| `src/web/packages.tsx`      | Package problems in words and "Import a file"                                                                                                                      |
| `src/web/forms-header.tsx`  | "Install a process pack" on Administration → Forms (`core.forms.header`)                                                                                           |

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
- Dry runs, applies and rollbacks that touch the same kinds run one after the other (a transaction-scoped advisory
  lock per kind), so two drafts of one package don't block on each other's uncommitted keys. Waiting longer than 60 s,
  or a lock or serialization failure, reads as `CHANGE_SET_BUSY` ("try again in a moment"); a duplicate key as
  `CONFLICT`. Other unexpected errors stay `INTERNAL` without their internals.
- A change set is visible to its creator, to holders of `assistant.change-sets.read`, and to the approvers of its
  review.
- Applying after an approved review runs as the deciding approver (`ctx.rbac.authFor`); if that fails, or the
  decision was automatic, the set returns to draft with the error and the creator is notified.
- Conversation tools act on the conversation's change set (its id is filled in); a pending confirmation expires when
  the person sends another message.

## API, events and tools

- Routes: `GET /status`, `/conversations` (+ `/{id}`, `/{id}/messages` SSE, `/{id}/confirmations/{toolCallId}`),
  `/change-sets` (+ `/{id}`, `/items`, `/check`, `/refresh`, `/apply`, `/submit`, `/withdraw`, `/rollback`,
  `/discard`, `/export`; `/import`), `/packages` (+ `/{module}/{key}`, `/{module}/{key}/install`),
  `/templates/{kind}/{templateId}`,
  `/templates/build`.
- Events: `assistant.change-set.created`, `.submitted`, `.applied`, `.returned`, `.rolled_back`, `.discarded`.
- Tools: `list_kinds`, `describe_kind`, `list_objects`, `get_object`, `propose_change`, `remove_change`,
  `get_change_set`, `update_change_set`, `request_review`, and the destructive `apply_change_set` and
  `rollback_change_set` (never offered over MCP).

```bash
pnpm --filter @isbp/module-assistant db:generate   # after changing src/server/schema.ts
pnpm --filter @isbp/module-assistant test
```
