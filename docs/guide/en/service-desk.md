# Service desk guide

This guide is for service desk agents and leads. It covers the daily work on tickets: picking up your queue,
keeping to the SLA, replying to people, resolving and closing, and the tools around tickets — Helpdesk AI, the
knowledge base, the CMDB and the reports. Changes and the CAB have their own guide:
[Changes and releases](changes-and-releases.md).

## What you can do here

- [Work your queue](#work-your-queue) and see what is breached or at risk first
- [Know the ticket types and their statuses](#know-the-ticket-types-and-their-statuses)
- [Set the priority](#set-the-priority) from impact and urgency, and [meet the SLA](#meet-the-sla)
- [Log a ticket for someone](#log-a-ticket-for-someone) who calls or walks up to the desk
- [Work a ticket](#work-a-ticket): assign, reply, add work notes, attach files, link records
- [Resolve, reopen and close a ticket](#resolve-reopen-and-close-a-ticket), with a satisfaction rating
- [Fulfil a service request](#fulfil-a-service-request) that came in through a catalog form
- [Investigate a problem and record a known error](#investigate-a-problem-and-record-a-known-error)
- [Run a major incident](#run-a-major-incident)
- [Use Helpdesk AI on a ticket](#use-helpdesk-ai-on-a-ticket) for triage, similar tickets, reply drafts and summaries
- [Find and write knowledge articles](#find-and-write-knowledge-articles)
- [Check what a configuration item affects](#check-what-a-configuration-item-affects) in the CMDB
- [Read the service desk reports](#read-the-service-desk-reports)
- [Work a ticket synced with ServiceDesk Plus](#work-a-ticket-synced-with-servicedesk-plus)

> **Tip:** If you don't see **Service desk → Tickets** in the sidebar, ask an administrator for the **Service
> desk agent** role. The role can cover every department or only some; you see the tickets of the departments
> it covers. In the demo, the `helpdesk` user is a service desk agent.

## Work your queue

Start every shift here: the workspace shows the tickets waiting for you and your teams, with their SLA timers.

1. Go to **Service desk → Tickets**.
2. Pick a queue on the left. The number next to each one is its count of open tickets.
   - **Assigned to me** — tickets you own.
   - **My groups** — open tickets assigned to any group you are a member of.
   - **Unassigned** — tickets in your groups that nobody has picked up yet.
   - **All open** — every open ticket you can see.
   - **Breached SLA**, **At risk** and **Major incidents** — the tickets that need attention first. Their counts
     turn red when they aren't zero.
3. Narrow the list with the search box (a title, or a number such as `INC-00042`) and the filters: **Type**,
   **Status** (**Open** by default, or **Done**, **Any status**, or one status), **Priority**, **Assignment
   group**, **Assigned to** and **Category**. **Clear filters** resets them.
4. Select a row to open the ticket.

**What happens next:** the queues and the list refresh every minute. The queue and filters are part of the page
address, so you can bookmark a view or share it with a colleague. The **Service desk** card on the home dashboard
shows the same queues and your most urgent tickets.

> **Tip:** On a phone, the queues are in a drop-down above the list.

![The service desk workspace with its queues](../../../apps/web/public/help/en/service-desk-workspace.jpg)

## Know the ticket types and their statuses

Every ticket has a type and a number. Each type has its own lifecycle, and the **Status** menu on a ticket only
offers the moves that type allows.

| Type            | Number  | Use it when                                         | Statuses                                                                                |
| --------------- | ------- | --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Incident        | `INC-…` | Something is broken or not working as it should     | New → In progress ⇄ On hold → Resolved → Closed, or Cancelled                           |
| Service request | `SR-…`  | Someone needs something (often from a catalog form) | (Waiting for approval →) New → In progress ⇄ On hold → Fulfilled → Closed, or Cancelled |
| Problem         | `PRB-…` | You are looking for the cause behind incidents      | New → Investigating → Known error → Resolved → Closed, or Cancelled                     |
| Change          | `CHG-…` | Something will be changed in production             | See [Changes and releases](changes-and-releases.md)                                     |

A resolved incident or fulfilled request can go back to **In progress** (reopened) or on to **Closed**.

## Set the priority

The priority (P1 to P4) decides which SLA targets apply and how the ticket sorts against others. It comes from
the ITIL matrix of impact and urgency:

| Impact ↓ / Urgency → | High | Medium | Low |
| -------------------- | ---- | ------ | --- |
| **High**             | P1   | P2     | P3  |
| **Medium**           | P2   | P3     | P4  |
| **Low**              | P3   | P4     | P4  |

1. Open the ticket and find the **Details** card on the right.
2. Set **Impact** (**High — many people or a critical service**, **Medium — a team or department**, **Low — one
   person**) and **Urgency** (**High — work is blocked**, **Medium — work is slowed down**, **Low — it can wait**).
   Each change saves at once.
3. **Priority** follows the matrix (**From impact × urgency**). To override it, pick **P1 · Critical** to **P4 ·
   Low** in the same list; to go back to the matrix, pick **From impact × urgency** again.

**What happens next:** an override says **Overridden by hand; the change is in the timeline**, and the timeline
records who changed what. Running SLA timers move to the targets of the new priority.

## Meet the SLA

An SLA policy gives each ticket two targets: **First response** and **Resolution**. They are counted in business
time on a calendar with working hours and holidays, so the clock doesn't run at night, at weekends or on public
holidays unless the calendar is open 24×7.

- **Which policy applies.** The first active policy (in the order the service desk administrator set) whose
  conditions match the ticket when it is raised. A later priority change keeps that policy but uses the target
  for the new priority.
- **Where you see it.** Under the ticket's title (**First response** and **Resolution**, with **Due** or
  **Stopped** and a time), in the **SLAs** card (**On track**, **Paused**, **Met**, **Breached**) and in the **SLA**
  column of the lists.
- **First response** is met by the first public reply from someone other than the requester, by moving the ticket
  to **In progress**, or by resolving it.
- **Pausing.** The clock stops in the statuses the policy names, typically **On hold**. Reopening a resolved ticket
  picks the resolution clock up where it stopped; the time it spent resolved doesn't count.
- **Warnings and breaches.** When a share of the target has passed (**Warn at**), the assignee — or every member
  of the group when nobody is assigned — gets **SLA at risk** and the ticket appears in **At risk**. At the
  deadline they get **SLA breached** (in-app and email), the timeline records it and the ticket moves to
  **Breached SLA**.

In the demo there are two business calendars, **Taipei office hours** (09:00–18:00 on weekdays, Taiwan holidays)
and **24×7**, and three policies:

| Policy                    | Applies to       | Targets                                                     | Pauses in                     |
| ------------------------- | ---------------- | ----------------------------------------------------------- | ----------------------------- |
| Critical incidents (24×7) | P1 incidents     | 15 min response, 4 h resolution, round the clock            | Never                         |
| Incidents                 | Other incidents  | P1 30 min / 4 h, P2 1 h / 8 h, P3 4 h / 24 h, P4 8 h / 40 h | On hold                       |
| Service requests          | Service requests | 4 business hours to respond, three business days to fulfil  | On hold, Waiting for approval |

> **Tip:** Put a ticket **On hold** while you wait for the requester or a supplier, and say why in a reply. It
> only pauses the clock when the policy names **On hold**.

Leads and administrators maintain policies and calendars in **Administration → Service desk** (**SLA policies**
and **Calendars** tabs), with the **Service desk administrator** role. See
[Administrators](administrators.md).

## Log a ticket for someone

When someone phones, emails or walks up to the desk, log the ticket for them so they can follow it under **My
requests**.

1. Go to **Service desk → Tickets** and select **New ticket**.
2. Choose the **Ticket type**: incident or service request (problems too, if you have the **Problem manager**
   role).
3. In **Requester**, pick the person. Leave it empty to log it as yourself.
4. Write a **Title** and a **Description** (Markdown is supported).
5. Set **Impact** and **Urgency**; the priority follows the matrix.
6. Choose a **Category**. If you leave **Assignment group** empty, the ticket goes to the category's default
   group, or to the service desk's default group.
7. Optionally pick **Assigned to**, the **Affected configuration items**, and for an incident **Major incident**.
8. Select **Create ticket**.

**What happens next:** the requester gets "INC-… received" and sees the ticket under **My requests**. The assignee
is notified, the SLA timers start, and Helpdesk AI suggests a triage if it is turned on.

## Work a ticket

The ticket page has the description, attachments and **Activity** (the timeline and the reply box) on the left,
and the **AI assist** panel, **Details**, **Affected CIs**, **Links**, **Linked records** and **SLAs** on the
right.

**Take it.** Select **Assign to me** in the action bar, or change **Assignment group** and **Assigned to** in
**Details**. Moving a ticket to another group drops an assignee who isn't a member of it. The new assignee gets
"Assigned to you".

**Correct the requester.** If the ticket was logged for the wrong person, pick the right one in **Requester** in
**Details**. The ticket moves to their **My requests**, the previous requester no longer sees it (unless it is for
them), and its department and SLA targets stay the same. The timeline records the change.

**Reply or add a work note.** Below **Activity**:

1. Choose **Reply to requester** for a message the requester sees, or **Work note** for something only agents
   see.
2. Write it (Markdown is supported) and select **Send reply** or **Add note**, or press ⌘/Ctrl + Enter.

The requester is notified of replies. When the requester answers, the assignee is notified (or the group when
nobody is assigned).

**Edit the title or description** with **Edit** in the action bar.

**Attach files.** In **Attachments**, select **Upload** or drag files in. Files are checked for type, size and
malware before they are stored.

**Link other tickets.** In **Links**, select **Link**, choose how this ticket relates (**Related to**, **Caused
by**, **Duplicate of**, **Parent of**, **Implements fix for**), type the other ticket's number and select
**Link**. Only incidents and service requests can be caused by a problem; only a change implements the fix for an
incident or a problem; parent and child tickets must be of the same type.

**Link other records.** In **Linked records**, select **Link record** to relate the ticket to an asset, a release,
a project task, a knowledge article or any other record. Links you can't open show only as a count.

**Record the affected CIs.** In **Affected CIs**, select **Edit**, search for configuration items, and **Save**.
Critical CIs are marked **Critical**.

![An incident with its SLA timers and the AI assist panel](../../../apps/web/public/help/en/service-desk-ticket.jpg)

## Resolve, reopen and close a ticket

When the work is done, resolve the ticket so the requester can confirm the fix.

1. Select **Resolve** (incidents) or **Fulfil** (service requests).
2. Choose a **Resolution code**: **Solved**, **Workaround provided**, **User error / how-to**, **Duplicate**, **No
   fault found** or **Not reproducible**.
3. Write the **Resolution notes**. The requester sees them.
4. Select **Resolve** or **Fulfil**.

**What happens next:**

- The SLA timers stop, and the requester is notified and asked **Is it fixed?**
- **Yes, close it** closes the ticket. The requester can rate the service from 1 to 5 stars and add a comment;
  you see **Rated … out of 5** on the **Resolution** card, and the rating counts in **Satisfaction** in the
  reports.
- **No, it's still broken** asks for the reason, puts the ticket back **In progress**, and notifies you.
- If the requester does neither, the ticket closes by itself after 5 days (an administrator can change this
  under **Administration → Modules**).
- Resolved tickets feed Helpdesk AI's similar-ticket search.

You can also close a resolved ticket, or reopen it, from **Status → Move to**. To cancel a ticket, choose
**Cancelled** there and give a code (**Duplicate**, **Cancelled by requester**, **User error / how-to** or **No
fault found**) and a reason; the requester is told it was cancelled.

## Fulfil a service request

Most service requests come from request forms in the portal. The service desk administrator decides, per
published form, how it is fulfilled (**Administration → Service desk → Service catalog**): the category, the
**Fulfilment group**, the priority, and whether the ticket is created **When submitted** or **When approved**.

In the demo, the **Laptop request** form goes to the requester's department head, and to IT asset management too
above 60 000 TWD. Approved requests become service requests in Hardware › Laptop for the Service Desk group.

1. Open the service request from your queue. Its channel is **Request form**.
2. Read **Request details** (the answers on the form). The chip **From request REQ-…** with the form's name opens the
   original request.
3. Do the work, replying to the requester as needed.
4. Select **Fulfil**, choose a code, write the notes and select **Fulfil**.

**What happens next:** the requester follows a single reference (`REQ-…`) under **My requests**, from approval to
fulfilment; its status follows your ticket. A ticket created when the form was submitted waits in **Waiting for
approval** until the approval finishes, and is cancelled if the request is rejected. See
[Employees](employees.md) for what the requester sees.

## Investigate a problem and record a known error

When the same incident keeps coming back, open a problem to find and remove the cause. You need the **Problem
manager** role.

1. Go to **Service desk → Problems**. The tabs show **Open**, **Known errors**, **Resolved** and **All**.
2. Select **New problem**, or open an existing one, and move it to **Investigating** with **Status**.
3. In the **Problem** card, select **Edit** and write the **Root cause** and the **Workaround**. Select **Save
   changes**.
4. Once the cause and workaround are documented, turn on **Known error**. The problem moves to **Known error**.
5. Link the incidents it causes: on each incident, in **Links**, choose **Caused by** and the problem's number.
   The **Problem** card lists the linked incidents.
6. When the cause is removed (often by a change that **Implements fix for** the problem), resolve the problem
   with a code and notes, then close it.

In the demo, PRB-00001 "VPN client 5.2 crashes on macOS 15" is a known error with linked VPN incidents, and
the agents-only article "Known error: VPN client 5.2 crashes on macOS 15" carries the workaround.

> **Tip:** Write the workaround as an **Agents only** knowledge article, so Helpdesk AI suggests it on new
> incidents. Then choose it in **Knowledge article** on the **Problem** card, so agents can open it from the problem.

## Run a major incident

Declare a major incident when an outage hits many people or a critical service and needs one coordinated
response.

1. Open the incident and turn on **Major incident** in **Details** (or when you log it).
2. Use the ticket as the single place for the response: the red **Major incident** banner reminds everyone to
   coordinate there and keep stakeholders updated with public replies.
3. Link the incidents other people raise about the same outage: in **Links** on the major incident, choose
   **Parent of** and the other incident's number.
4. Post updates as replies at regular intervals, and resolve the major incident when service is restored.

**What happens next:** the ticket shows in the **Major incidents** queue, and **Service desk reports** count the
open major incidents. If **Announce major incidents in team channels** is on (it is by default), the platform
posts a "Major incident" message with the ticket's number and title to the organisation's subscribed Teams, Slack
and webhook channels.

> **Important:** A reply reaches the requester of the ticket you write it on. Tell the people on the linked
> incidents on their own tickets, or resolve those tickets when the major incident is fixed.

In the demo, INC-00101 "Email delivery delays for all staff" is an open major incident with three linked
incidents from people whose email is late.

## Use Helpdesk AI on a ticket

The **AI assist** panel at the top of the right-hand column helps you triage, answer and document a ticket. You
need the **AI-assisted agent** role.

The badge in the panel's header says which mode answered:

| Feature                   | **Builtin · no LLM** (no model configured)                         | **Language model**                                            |
| ------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| Triage suggestion         | A vote of the most similar resolved tickets, with its agreement    | The similar tickets, refined by the model, with a rationale   |
| Similar tickets, articles | Search of resolved tickets and the knowledge base                  | The same                                                      |
| Reply draft               | A template that quotes the best article's steps and links it       | A reply grounded in knowledge articles, with numbered sources |
| Summary                   | The issue, latest updates and current state, taken from the ticket | A written summary of the description and timeline             |
| KB draft                  | An article filled from the ticket's fields                         | A symptoms / cause / resolution article                       |

1. **Triage suggestion** shows the suggested category, group and priority (with impact and urgency) and a
   **Confidence** meter. Select **Apply** for one field, **Apply all**, or **Dismiss**. If there is no
   suggestion yet, select **Suggest triage**.
2. **Similar resolved tickets** lists earlier tickets with a percentage match and how they were resolved.
3. **Suggested articles** lists knowledge articles; **Insert link** adds a link to the reply.
4. **Draft a reply** writes a reply in the requester's language. Read it, select **Insert into reply**, edit it in
   the reply box, and send it yourself.
5. **Summary** → **Summarize** gives the issue, the latest updates and the current state, which helps when you
   take over a ticket.
6. On a resolved, fulfilled or closed ticket, **Knowledge article** → **Draft KB article** creates a draft article
   (symptoms, cause, resolution, applies to) for an editor to review. You need permission to write articles.

**What happens next:** nothing is sent or published without you. Generated text is labelled **Builtin template —
review before sending**, or with the model's name ("Written by … — review before sending"). With a language model, personal data
is masked before the text leaves the platform. If an administrator turns on **Apply confident suggestions
automatically**, Helpdesk AI fills only the fields that are still empty, and the timeline says so.

Leads with the **Helpdesk AI administrator** role see triage acceptance, deflection by Ask IT and AI cost in
**Service desk → AI insights**. More on AI modes and privacy: [Assistant and AI](assistant-and-ai.md).

## Find and write knowledge articles

The knowledge base holds self-service answers for everyone and troubleshooting guides for agents. Ask IT,
Helpdesk AI and the **Report an issue** page all search it, so a good article saves tickets.

**Find an answer.** Go to **Knowledge** and type in **How can we help?** Search works across languages: a
question in English also finds Chinese and Japanese articles. You can also **Browse by topic**. With the
**Knowledge agent** role you also see articles whose audience is **Agents only**. An article shows its other
languages under **Other languages**, and **Related articles**. Knowledge agents and editors also see **Linked
records** and, for an article synced with ServiceDesk Plus, a **Synced with** card.

**Write an article and get it published.** Writing needs the **Knowledge agent** role; publishing needs the
**Knowledge editor** role.

1. Go to **Knowledge → Manage articles** and select **New article**.
2. Fill in **Title**, **Summary** (shown in search results) and **Article** (Markdown; use **Preview** to check
   it). Choose a **Category**, **Tags**, the **Audience** (**Everyone** or **Agents only**), the **Language** and,
   optionally, a **Review by** date.
3. Select **Save draft** to continue later, or **Save and submit** when it is ready.
4. An editor opens it (**Manage articles → In review**) and selects **Publish**. While it is in review, you can
   **Withdraw from review** to change it.

**What happens next:** every publish is kept as a version (**History**). If an administrator has turned on the
**Publishing a knowledge article** approval, submitting sends the article for approval instead, and it goes live
when approved; you are notified either way. An editor's own submission is published straight away when no
approval applies. To change a live article, an editor selects **Edit** and **Publish update**, which makes a new
version. **Retire** takes an article out of search; **Restore as draft** brings it back.

**Translate an article.** On the article, select **Translate**. The new article is linked as a translation, so
readers can switch languages; each language has its own number and goes through review on its own.

**Act on feedback and review dates.** Readers answer **Was this article helpful?**; a "No" (with an optional
comment) notifies the owner. Each published article has a review date (by default 180 days after it is first
published). When it is due, the owner is reminded every week, the article shows a banner, and it is listed
under **Manage articles → Review due**. Check the content, then **Edit** it and set a new **Review by** date.

In the demo, try searching for "vpn keeps dropping". **Manage articles** shows an article in review (Microsoft
Teams) and one due for review ("Clear a stuck print queue").

![A knowledge article with its translations and version history](../../../apps/web/public/help/en/service-desk-knowledge-article.jpg)

## Check what a configuration item affects

The CMDB records the services, applications, servers, databases and network devices IT runs, and how they
depend on each other. Use it to see who supports a system and what breaks when it fails. Browsing needs the
**CMDB viewer** role; creating and editing CIs, relationships and classes needs the **CMDB manager** role.

1. Go to **Configuration items**. Use the tabs (**All**, **Business services**, **Applications**,
   **Infrastructure**), the search box (a name or a number such as `CI-00042`) and the filters.
2. Open a CI. **Overview** shows its details, owner and **Support group**, a summary of **If this fails**, and
   **Related work**: the open tickets that affect it (with **View all**) and the application it belongs to.
3. **Relationships** lists how it relates to other CIs (**Depends on**, **Runs on**, **Connects to**,
   **Contains**, **Backs up** and their reverses). CMDB managers select **Add relationship**.
4. **Impact** shows, as a **Graph** or a **List**, what is **Impacted if it fails** (above) and what it **Depends
   on** (below), up to the **Depth** you choose, with the number of business services affected.

Impact analysis follows **Depends on**, **Runs on** and **Contains**; **Connects to** and **Backs up** are for
information only.

**Link CIs to tickets.** Record the affected CIs on each ticket (see [Work a ticket](#work-a-ticket)). They show
on the CI's page, help you spot related incidents during an outage, and on a change they drive the conflict check
and the CAB routing.

In the demo, open `tpe-sw-core-01` (CI-00036): losing the core switch impacts most business services.

![The impact graph of the core switch](../../../apps/web/public/help/en/service-desk-ci-impact.jpg)

## Read the service desk reports

Leads use the reports for daily stand-ups and monthly service reviews.

1. Go to **Service desk → Service desk reports**.
2. Choose the period: **Last 7 days**, **Last 30 days** or **Last 90 days**.
3. Read the figures at the top: **Open tickets** (with open major incidents), **SLA breaches** (response and
   resolution), **Mean time to resolve**, **Satisfaction** and **SLA compliance**.
4. Below them: **Created vs. resolved**, **Open by priority**, **Backlog age**, **Top categories** and **Time to
   resolve by priority**. Each chart can be shown as a table with **Show as**.

You need the **Service desk agent** role (or another role with service desk reports).

## Work a ticket synced with ServiceDesk Plus

Some tickets are kept in step with requests in our on-premises ManageEngine ServiceDesk Plus by the Integrations
Hub. You work them in ISBP as usual; the hub copies the changes both ways.

- **The Synced with card** on the right shows the connection (in the demo, **Contoso ServiceDesk Plus**), the
  request number (it opens the request in ServiceDesk Plus), the state (**In sync**, **Conflict**, **Error** or
  **Deleted on one side**) and **Last synced**. People with the **Integrations administrator** role also see
  **Sync now**.
- **Timeline entries** written by the sync say where they came from, for example "via Contoso ServiceDesk Plus
  #1234". Tickets created by the sync show the channel **Integration**.
- **Your work goes across.** Edits, status changes, and replies and work notes (when the profile syncs comments)
  are sent to ServiceDesk Plus; changes made there come back. Statuses still follow the ticket's lifecycle, and
  SLAs and notifications work as for any other ticket.
- **Conflicts.** If the same field was changed on both sides, the card shows **Conflict** and an integration
  administrator decides which value to keep.

How connections, profiles and conflicts work: [Integrations](integrations.md).

## How it connects

- **Employees** report issues, follow them under **My requests**, confirm fixes and rate the service:
  [Employees](employees.md).
- **Changes** that fix problems go through CAB approval: [Changes and releases](changes-and-releases.md).
- **Assets**: "Report a problem" on a device opens a ticket already linked to it: [Assets](assets.md).
- **Ask IT and Helpdesk AI** answer from the knowledge base and raise tickets only when the person confirms:
  [Assistant and AI](assistant-and-ai.md).
- **ServiceDesk Plus** tickets and solutions sync through the hub: [Integrations](integrations.md).
- **Categories, SLA policies, calendars, the service catalog and approval workflows** are set up by
  administrators: [Administrators](administrators.md).
- Terms such as incident, problem, known error and SLA: [Glossary](glossary.md).
