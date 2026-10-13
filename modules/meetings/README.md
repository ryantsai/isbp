# Meetings module

Meeting minutes: meetings with attendees and the notes typed during them, organised (AI or builtin) into a summary,
decisions, open questions and action items. Action items about a project become its tasks; the rest are tracked
here, on their owners' My work, with reminders. The module depends on no other module: projects are reached through
the record registry (`ctx.records`) and the AI tool registry (`projects.create_task`, as the person sending the
minutes), and project tasks through their events. Design: `docs/architecture.md` §17.4–17.5.

| File                         | What it does                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/model.ts`               | Vocabulary and pure rules: references (MTG-00042), the builtin organiser (en, zh-TW, ja markers), owners, due dates |
| `src/contracts.ts`           | Zod DTOs shared by the API, the pages and the AI tools                                                              |
| `src/manifest.ts`            | Navigation, permissions, roles, events, notifications, AI tools, My work, the `meeting` record type                 |
| `src/server/schema.ts`       | Tables in the `meetings` schema: meetings, attendees, action items (exported as `/schema`)                          |
| `src/server/access.ts`       | Who may see and change a meeting: organiser, attendees, item owners (read), readers, admins                         |
| `src/server/meetings.ts`     | `MeetingService`: meetings, organising, accepting and sending minutes, follow-ups, search index                     |
| `src/server/action-items.ts` | `ActionItemService`: items, routing to project tasks, following tasks, reminders                                    |
| `src/server/records.ts`      | The `meetings.meeting` record resolver and global search                                                            |
| `src/server/ai.ts`           | AI tools `meetings.find_meetings`, `my_action_items`, `create_minutes`                                              |
| `src/server/work.ts`         | My work: open items tracked here, of sent minutes                                                                   |
| `src/server/seed.ts`         | Demo meetings, run by the API seed's link phase (`seed-phase11.ts`) after Projects has its data                     |
| `src/web/*`                  | Meetings list, meeting page (notes, minutes, items), organise sheet, My action items                                |

Rules worth knowing:

- Permissions: `meetings.meetings.use` (everyone, role `meetings-member`), `meetings.meetings.read` (every meeting,
  `meetings-reader`), `meetings.meetings.admin` (`meetings-admin`). Private meetings are seen by the organiser, the
  attendees and the owners of their items; internal ones by everyone with `use`.
- "Organise" stores nothing: it proposes minutes (`ctx.ai.chat`, feature `meetings.organise`, or the builtin
  organiser) and the person saves what they accept. Owners must be attendees.
- Sending the minutes (once, claimed with a conditional update) notifies the attendees, starts the items and, after
  commit, creates each `task` item in its project as the sender. A refusal (403/404/400 from Projects) keeps the item
  here with `routeError`; a created task is linked to the meeting, and its status/assignee/deletion flow back to the
  item (`projects.task.*` events).
- The `action-item-reminders` job (08:00 Asia/Taipei) reminds owners of items tracked here the day before they're
  due, and weekly while overdue (the organiser the first time).
- Minutes are indexed for search after commit with the meeting's readers as the ACL.

```bash
pnpm --filter @isbp/module-meetings db:generate   # after changing src/server/schema.ts
pnpm --filter @isbp/module-meetings test
```
