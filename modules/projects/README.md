# Projects module

Project management for IS: projects, tasks, milestones, a Kanban board, a Gantt timeline with
dependencies, workload, and status reporting (status updates per period, consolidated into a templated status
report). Links to tickets, changes, CIs and releases go through the platform's record
links (`ctx.records`), so the module depends on no other module. The UI calls it "Projects".

| File                             | What it does                                                                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/model.ts`                   | Vocabulary and pure rules: permissions, statuses, references, board ranks, status flow, workload math                                                          |
| `src/contracts.ts`               | Zod DTOs shared by the API and the pages (dates are `YYYY-MM-DD` calendar days)                                                                                |
| `src/manifest.ts`                | Navigation, permissions, roles, events, settings, AI tools, the `projects.proposal` workflow, records                                                          |
| `src/server/schema.ts`           | Tables in the `projects` schema (exported as `@isbp/module-projects/schema`)                                                                                   |
| `src/server/access.ts`           | Who may see and do what in a project, used by routes, resolvers, search and AI tools                                                                           |
| `src/server/projects.ts`         | `ProjectService`: projects, members, milestones, health, status flow and the proposal approval                                                                 |
| `src/server/tasks.ts`            | `TaskService`: tasks, board moves, timeline, dependencies, comments, activity, reminders                                                                       |
| `src/server/workload.ts`         | `WorkloadService`: planned hours per person per ISO week against capacity                                                                                      |
| `src/server/records.ts`          | Record resolvers (`projects.project`, `projects.task`) and global search                                                                                       |
| `src/server/ai.ts`               | AI tools `projects.my_tasks`, `find_tasks`, `create_task`, `update_task_status`, `project_status`                                                              |
| `src/server/seed*.ts`            | Demo portfolio (stable keys NET, ERP, ZTA, M365, KHH, ITSM; the cross-module seed links task titles)                                                           |
| `src/status.ts`                  | Pure status-reporting rules: periods, standings, a project's report state and reasons, templates                                                               |
| `src/server/reporting.ts`        | The schedule, opening the period's expected updates, reminders (job `status-updates`)                                                                          |
| `src/server/status-updates.ts`   | `StatusUpdateService`: post/edit updates (a manager's sets health), drafts, My work                                                                            |
| `src/server/status-report.ts`    | `StatusReportService`: the report per reader, the AI or builtin narrative (cached), Markdown export                                                            |
| `src/server/report-templates.ts` | Report templates (built-in executive/detailed, PMO-editable)                                                                                                   |
| `src/server/customizations.ts`   | Customisation kinds `status-schedule` and `report-template` (the assistant's change sets)                                                                      |
| `src/server/task-types.ts`       | Scheduled Jobs task type `status-report` ("Send the status report")                                                                                            |
| `src/server/meetings-link.ts`    | Meeting decisions through the `meetings.find_meetings` tool (no dependency on Meetings)                                                                        |
| `src/web/*`                      | Portfolio, project page (overview, board, list, timeline, workload, updates, settings), task page and sheet, status report, status updates, reporting settings |

Rules worth knowing:

- Permission keys have three segments: `projects.projects.use`, `projects.projects.create`,
  `projects.portfolio.read` and `projects.projects.admin` (roles `projects-member`, `projects-manager`,
  `projects-pmo`, `projects-admin`).
- New projects are `proposed`. "Start project" runs the required `projects.proposal` workflow: more than
  400 planned hours needs the owner's manager (fallback: the `projects-pmo` role), otherwise it is approved
  at once. The `proposalThresholdHours` setting only drives the UI hint; change it together with the
  workflow's condition in Administration → Workflows.
- Board ranks are fractional (base 36, `COLLATE "C"`); moves lock the project row and compute the rank
  between the neighbours on the server.
- Workload spreads each open task's remaining (else estimated) hours evenly over its working days from
  its start (or today) to its due date; capacity is allocation × `hoursPerWeek`.
- Every service method takes an `AuthContext` and re-checks membership, so routes, AI tools and the sync
  adapters share the same rules.
- **Status reporting (Phase 11, `docs/architecture.md` §17.1–17.3).** One organisation-wide schedule
  (`projects.reporting.manage`, role `projects-pmo`): weekly, biweekly or monthly; reporters are each active
  project's managers and/or a group's members on projects they belong to. The `status-updates` job (every 15 min)
  opens expected updates, reminds and tells managers what's missing. A project's report state (`delayed`, `at_risk`,
  `on_track`, `no_update`, `completed`) combines the reported status with the plan (slip, target passed, overdue
  milestones and tasks); `mismatch` flags updates rosier than the plan. The report is computed per reader (only
  projects they may see); its narrative is written by `ctx.ai` (feature `projects.status-report`) or builtin.
  Meeting decisions come from Meetings through the AI tool registry, as the reader, when that module is on.
- **Sync (Phase 5).** `src/server/sync.ts` adapts `projects.project` (matched on name; permission
  `projects.projects.sync`) and `projects.task` (inside a project, with comments; `projects.tasks.sync`) for the
  Integrations Hub. A synced project is created `proposed` with a key from its name and no manager yet;
  `proposed → active` stays the proposal approval's (409 `INVALID_TRANSITION`, `reason: 'approval_required'`).
  Tasks (matched on title within the project) keep the module's rules: an active assignee who isn't on the project joins it as a `member` at 0 % (audited with the source; viewers stay viewers), `in_progress` waits for dependencies, parents and
  milestones belong to the project, archived projects are read-only (409). Activity, comments and status
  history name the agent or the remote author and the source (`via` columns).

```bash
pnpm --filter @isbp/module-projects db:generate   # after changing src/server/schema.ts
pnpm --filter @isbp/module-projects test
```
