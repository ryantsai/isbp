# Meetings guide

This guide is for everyone who runs or attends meetings: project syncs, CAB meetings, vendor calls, team
stand-ups. **Meetings** keeps the notes you type during a meeting, turns them into minutes (a summary, the
decisions, the open questions and the action items) and makes sure the action items get done: items about a project
become tasks on its board, and the rest are tracked here with reminders for their owners.

## What you can do here

- [Record a meeting](#record-a-meeting) and choose [who can read it](#who-can-see-a-meeting)
- [Type the notes](#type-the-notes) during the meeting
- [Organise the notes into minutes](#organise-the-notes-into-minutes), with AI or from the notes' own markers
- [Send the minutes](#send-the-minutes): attendees are told, and project items become project tasks
- [Work on your action items](#work-on-your-action-items) and get [reminders](#reminders)
- [Hold a follow-up meeting](#hold-a-follow-up-meeting) that lists what is still open
- [Find decisions later](#find-decisions-later), in search, with the assistant and in project status reports

## Who can see a meeting

Everyone has the **Meeting participant** role: you can record meetings, read the ones you may see and work on your
action items.

| Who can read it | Who sees the meeting                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------- |
| **Private**     | The organiser, the attendees, the owners of its action items and people who read every meeting |
| **Internal**    | Everyone who uses Meetings                                                                     |

The organiser and the attendees change the meeting: its details, notes, minutes and action items, and they can send
the minutes. Only the organiser deletes it. An action item's owner who didn't attend can open the meeting to read it
and mark their item done.

The **Meeting reader** role reads every meeting, private ones included; the **Meetings administrator** role manages
every meeting. Administrators grant them in **Administration → Roles & access**.

## Record a meeting

Record the meeting before it starts or right after it, so the notes have a place to go.

1. Go to **Meetings** and select **New meeting**.
2. Enter a **Title**, when it **Starts** and its **Duration**.
3. Under **Attendees**, select **Add an attendee** for each person. You are the **Organiser** and attend
   automatically.
4. If the meeting is about a project, choose it under **Project**: its action items can then become tasks in that
   project.
5. Choose **Who can read it**: **Private** or **Internal**. Under **More details** you can add a **Location** and
   **Guests** (people without an account here, by name).
6. Select **Create**.

**What happens next:** the meeting page opens with **The minutes haven't been sent yet**. The meeting is linked to
the project, so it also appears in the project's linked records.

> **Tip:** The assistant can record a meeting for you from a conversation, with its notes: ask it to "record
> yesterday's vendor call with these notes". It creates a draft that you organise and send yourself.

## Type the notes

Type the notes as the meeting goes, in your own words, in the **Notes** box on the meeting page, then select
**Save notes**. Every attendee can edit them.

A few markers help the organiser find what matters:

- Start a line with **Action:** or **TODO**, or make it a checkbox (`- [ ]`), for something someone has to do.
- Name the owner with **@name** (for example `@Celestino`), or start with the name and a colon.
- Add a date: `by Friday`, `10/20` or `2026-10-20`.
- Start a line with **Decision:** for something that was decided.
- Questions (lines ending with `?`) become open questions.

The same markers work in Chinese and Japanese, for example **決議：** and **待辦：**, or **決定：** and
**アクション：**, with dates such as `10月24日` or `週五前`.

## Organise the notes into minutes

When the meeting is over, turn the notes into minutes.

1. On the meeting page, select **Organise**. Unsaved notes are saved first.
2. Check **Organised minutes**: the **Summary**, the **Decisions** and the **Open questions** (one per line).
3. Check each action item: **What has to be done**, its **Owner**, when it is **Due**, and **Where it is worked on**:
   **Tracked here**, or **Task in** the meeting's project. Clear **Add item** for any you don't want.
4. Select **Save minutes**, or **Discard**.

**What happens next:** the minutes are saved but nothing is sent yet. Items that will become tasks show **Becomes a
task in NET when the minutes are sent**. Select **Edit minutes** to change the text later, and **Add item** to add an
action item by hand.

With an AI chat model, the minutes are written up by AI in the notes' language, and the page says **Organised with
AI from the notes**. Without one, ISBP reads the notes' own markers and says **Organised from the notes**. Either
way, check the owners and dates before you save: only what you save is kept.

> **Note:** An owner has to be an attendee. If the notes name someone who wasn't there, the item has no owner and
> the sheet says **The notes say … who isn't an attendee**; choose the owner yourself.

## Send the minutes

Sending the minutes is what starts the follow-up.

1. Select **Send minutes**.
2. The confirmation says how many attendees get the minutes, how many action items start and how many become
   project tasks. Select **Send minutes**.

**What happens next:**

- The attendees get **Minutes of** the meeting, in ISBP and by email.
- The owners of items tracked here are told about their item.
- Each project item becomes a task in its project, created as you, with the owner as the assignee and the due date.
  The page says **Created tasks NET-42, NET-43** and links each item to its task. The project's own rules apply: if
  you can't add tasks to the project, or the owner isn't a member of it, the item stays here and shows **Stayed
  here:** with the reason.
- The meeting is linked to the tasks it created.

In the demo, **Network refresh — weekly sync** has sent minutes: two of its items are tasks in **Network refresh
2026** and one is tracked here.

## Work on your action items

Go to **Meetings → My action items** to see what came out of meetings for you.

- **Mine** lists items you own; **From my meetings** lists the items of meetings you organised.
- **Open**, **Done** and **All** filter them.
- Select **Done** when an item is finished, or **Reopen** if it isn't.

Your open items tracked here are also on **My work** under **Action items**, the soonest due first.

Items that became project tasks are worked on in **Projects**, like any other task: when the task is done, the item
shows as done too, and when the task is reassigned, the item follows it.

## Reminders

Every morning, owners of items tracked here are reminded the day before an item is due (**Due tomorrow**). When an
item is overdue, its owner is reminded once a week until it's done, and the organiser is told the first time.
Project tasks are reminded by Projects instead.

You choose how you get these in **Profile & preferences → Notifications**: **Action items assigned to me**, **My
action items due tomorrow**, **Overdue action items** and **Minutes of meetings I attended**.

## Hold a follow-up meeting

For a recurring meeting, start the next one from the last.

1. Open the meeting and select **Follow-up meeting**.

**What happens next:** a draft meeting opens with the same title, attendees, project and who can read it, a link
back (**Follows up …**) and **Open items from earlier**, so you can go through what is still open.

## Find decisions later

- **Search:** meetings appear in the search at the top of every page (**Meetings**), by title or reference such as
  MTG-00042.
- **The assistant** finds meetings by what was discussed ("what did we decide about the core cutover?"), lists your
  action items and records a meeting for you, with your permissions.
- **Project status:** the decisions of a project's meetings appear in the status report's **Decisions in meetings**
  section, and **Draft for me** on a status update uses them. See
  [Read the status report](projects.md#read-the-status-report).

## How it connects

- **Projects:** meeting items become project tasks, and meeting decisions feed status updates and the status report:
  [Projects guide](projects.md).
- **Linked records:** link a meeting to the change, ticket or CI it was about from **Linked records** on its page.
- **My work:** your open action items are listed with everything else waiting for you:
  [Employees guide](employees.md).
- **The assistant:** [Assistant and AI](assistant-and-ai.md).
