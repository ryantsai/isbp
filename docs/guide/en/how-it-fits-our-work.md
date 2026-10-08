# How ISBP fits our work

This guide maps the way our IT organisation works (requests, incidents, changes, releases, assets, access, data
feeds) to the areas of IS Big Platform, and walks through eight everyday situations that cross several areas. Read it
to see the big picture before your role guide, or to find out who does what when work passes between teams.

## What you can do here

- [Find where each IT practice lives in ISBP](#our-it-practices-in-isbp)
- [Understand the building blocks every area shares](#the-shared-building-blocks)
- Follow a scenario from start to finish:
  [a new joiner](#scenario-a-new-joiner-starts-on-monday),
  ["my VPN keeps dropping"](#scenario-my-vpn-keeps-dropping),
  [a laptop over 60 000 TWD](#scenario-a-laptop-over-60-000-twd),
  [a production release](#scenario-a-production-release),
  [an ERP data feed](#scenario-an-erp-data-feed),
  [database access for a developer](#scenario-database-access-for-a-developer),
  [working alongside ServiceDesk Plus and Azure DevOps Server](#scenario-working-alongside-servicedesk-plus-and-azure-devops-server)
  and [changing a process with the assistant](#scenario-changing-a-process-with-the-assistant)

## Our IT practices in ISBP

| Practice                          | What we do                                                                | Where in ISBP                                                                                      | Who                                                   |
| --------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Service requests                  | Give people access, equipment and software they ask for                   | **Requests** (forms, **Request access**), fulfilled as tickets in **Service desk → Tickets**       | Employees, approvers, service desk agents             |
| Incident management               | Restore service quickly when something breaks                             | **Ask IT**, **Report an issue**, **Service desk → Tickets**                                        | Employees, service desk agents                        |
| Problem management                | Find root causes, publish known errors and workarounds                    | **Service desk → Problems**                                                                        | Problem managers                                      |
| Knowledge management              | Write and review answers people can use themselves                        | **Knowledge**, **Knowledge → Manage articles**                                                     | Knowledge editors, agents                             |
| Service level management          | Agree and track response and resolution targets                           | SLA policies and business calendars in **Administration → Service desk**; **Service desk reports** | Service desk leads                                    |
| Change enablement                 | Assess, approve and schedule changes; avoid clashes                       | **Service desk → Changes**, CAB approvals in **Approvals**                                         | Change managers, the CAB                              |
| Release and deployment management | Plan versions, check readiness, record deployments, measure delivery      | **Applications → Applications**, **Applications → Release calendar**                               | Application owners, release managers, CI/CD pipelines |
| Service configuration management  | Know our services, servers and how they depend on each other              | **Configuration items** (the CMDB)                                                                 | CMDB managers, agents                                 |
| IT asset management               | Track hardware, licences, contracts and vendors from order to disposal    | **Assets** (**Hardware**, **Software**, **Contracts**, **Vendors**), **My devices**                | Asset managers, contract managers                     |
| Identity and access management    | Onboard and offboard people, grant and review access                      | **Administration → People**, **Groups**, **Roles & access**, **Applications**; **Request access**  | Identity administrators, HR partners, approvers       |
| Project and portfolio management  | Run IT projects and see who is working on what                            | **Projects → Projects**, **Projects → My tasks**                                                   | Project managers, project teams                       |
| Data integration                  | Publish data as APIs and move data between databases                      | **Data APIs & ETL**, **Administration → Database connections**                                     | Data and platform engineers                           |
| Job scheduling                    | Run recurring tasks and know when they fail                               | **Scheduled jobs**                                                                                 | Platform engineers, operators                         |
| Database access management        | Give people time-bound database roles, review them, find unmanaged access | **Database access**                                                                                | Developers, DBAs, reviewers                           |
| Working with existing tools       | Keep ServiceDesk Plus and Azure DevOps Server in step with ISBP           | **Administration → Integrations**                                                                  | Integration administrators                            |
| Platform configuration            | Change approval workflows, forms, fields and settings safely              | The **Assistant**, **Administration → Change sets**, the admin pages                               | Administrators, team leads                            |
| Audit and compliance              | Show who did what, and who has access and why                             | **Administration → Audit log**, **Profile & preferences → My access**, access reviews              | Auditors, security team                               |

## The shared building blocks

Every area of ISBP is built from the same pieces, so once you know them in one place, you know them everywhere.

| Building block         | What it means for you                                                                                                                                                                                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requests and approvals | Anything that needs a decision (access, a purchase, a change, a disposal, a project proposal, a database role, a change set) runs through an approval **workflow**. Approvers decide in one inbox, **Approvals**; requesters see the **Approval path**. Administrators design workflows in **Administration → Workflows**. |
| Notifications          | The bell in the header, plus email, Microsoft Teams, Slack or webhooks. You choose per type which reach you in the app and by email (**Profile & preferences → Notifications**). Texts are written in your language.                                                                                                       |
| Records and links      | Tickets, changes, assets, configuration items, releases, tasks and other records can be linked to each other in the **Linked records** panel (**Link record**), across areas. You only see linked records you're allowed to open.                                                                                          |
| Attachments            | Screenshots, contracts and documents go in the **Attachments** panel of a record. Files are checked before they're stored.                                                                                                                                                                                                 |
| Custom fields          | Administrators add our own fields (a cost centre, an affected site) to people, groups, departments and module records in **Administration → Custom fields**. Forms use the same kind of fields.                                                                                                                            |
| Roles and permissions  | What you see and can do comes from roles, given to you or to your groups, sometimes only for a department or one record, sometimes until a date. **Profile & preferences → My access** shows yours.                                                                                                                        |
| Audit log              | Every change, sign-in and access decision is recorded in **Administration → Audit log**, which can't be edited.                                                                                                                                                                                                            |
| AI and the assistant   | **Ask IT** answers employees from the knowledge base. **Helpdesk AI** helps agents triage and reply. The **Assistant** in the header works with you on any page and prepares configuration changes as change sets. All of it uses your permissions and masks personal data before anything leaves the platform.            |

## Scenario: a new joiner starts on Monday

A new sales colleague joins next week. HR creates the account, the manager orders a laptop and asks for access, and
the colleague signs in on day one.

People involved: an HR partner (in the demo, `hr.partner`, who manages people in the Sales department), the new
joiner's manager, approvers, the service desk and an asset manager.

1. The HR partner opens **Administration → People**, selects **Add person**, fills in the profile (department,
   manager) and, under **Start as**, chooses **Pre-boarded**: the account exists but can't sign in yet. See
   [Administrators](administrators.md).
2. The manager orders the laptop: **Requests → Request a laptop or equipment**, ticks **This is for someone else** and
   chooses **Who is it for?**, then selects **Submit**. The form's approvals run in **Approvals**, and the approved
   request becomes a service desk ticket. See
   [Request equipment or software](employees.md#request-equipment-or-software-with-a-form).
3. The manager requests access before the first day: **Requests → Request access**, chooses the role (for example a
   **Finance ERP** role), **Who needs it?** → **Someone else** and picks the new joiner (marked **Pre-boarded**), a
   duration and the reason, then **Send request**. The review step shows who will approve it. See
   [Request access](employees.md#request-access-to-an-application-or-a-role).
4. The approvers decide in **Approvals**. See [Approve or reject a request](employees.md#approve-or-reject-a-request).
   When the last approval is in, the role is granted automatically, with its end date. It takes effect when the
   person is onboarded.
5. On day one, the HR partner selects **Onboard** on the person's page. The new joiner can now sign in, and their
   access works straight away: they see it under **Profile & preferences → My access**, and business applications
   that ask ISBP who has which role (through the Role Query API) see the grant.
6. An asset manager takes a laptop that is **In stock** in **Assets → Hardware**, selects **Assign** and chooses the
   new joiner. The laptop becomes **Deployed** and shows under the new joiner's **My devices**. The agent then
   selects **Fulfil** on the ticket. See [Assets](assets.md). The **New joiner IT checklist** article in
   **Knowledge** covers the rest of their first week.

> **Note:** You can request access for active and pre-boarded people. Requests for someone who is suspended or
> offboarded are refused. If the person is suspended or offboarded while a request is waiting for approval, the
> request ends as **Couldn't be granted** and nothing is granted.

> **Tip:** When someone leaves, **Offboard** on their page disables sign-in, ends their sessions, can remove their
> groups and roles, and tells the other areas, so that, for example, their database accounts are removed.

## Scenario: "my VPN keeps dropping"

An employee working from home loses the VPN every few minutes. Most of the time a knowledge article solves it;
otherwise the service desk does, and the fix makes the next answer better.

People involved: the employee, Ask IT, a service desk agent (in the demo, `helpdesk`), the network team.

1. The employee opens **Ask IT** and writes "VPN keeps disconnecting". Ask IT answers from the knowledge base, in
   the demo from **VPN disconnects every few minutes**, and lists it under **Sources**.
2. If the steps work, the employee selects **That solved it**: no ticket needed. Otherwise, **I still need help**,
   **Review ticket** and **Create ticket**. See [Ask IT](employees.md#ask-it-before-you-raise-a-ticket).
3. The incident appears in **Service desk → Tickets**. Helpdesk AI suggests the category (VPN), the assignment group
   and the priority, and shows similar resolved tickets. The SLA timers start.
4. The agent sees the ticket matches the known error **VPN client 5.2 crashes on macOS 15** (a problem in
   **Service desk → Problems**), applies its workaround and resolves the ticket. See
   [Service desk](service-desk.md).
5. The employee gets a notification, opens the ticket, selects **Yes, close it** and rates the service. See
   [Confirm a fix](employees.md#confirm-a-fix-and-rate-the-service).
6. If the fix isn't in the knowledge base yet, the agent turns the ticket into a draft article, which an editor
   reviews and publishes, so Ask IT can answer the next person.

## Scenario: a laptop over 60 000 TWD

Laptop requests are approved by the department head; above 60 000 TWD, IT asset management approves too. The
approved request is fulfilled by the service desk and ends up as an asset assigned to the requester.

People involved: the employee, their department head, an asset manager, a service desk agent.

1. The employee opens **Requests**, selects **Laptop request**, chooses the **Model**, enters the **Estimated cost
   (TWD)** (say 72 000) and **Why do you need it?**, and selects **Submit**. See
   [Request equipment or software](employees.md#request-equipment-or-software-with-a-form).
2. **Department head approval** comes first. Because the cost is above 60 000 TWD, the **IT asset management** step
   follows, decided by an asset manager. Both decide in **Approvals**.
3. Once approved, the request becomes a service request ticket in the **Hardware › Laptop** category for the service
   desk. The requester's request page shows **Being fulfilled** and **Open SR-…**.
4. The asset manager assigns a laptop from stock in **Assets → Hardware** (**Assign**), and links the asset to the
   ticket under **Linked records**.
5. The agent selects **Fulfil** on the ticket. The request page shows **Fulfilled**, and the laptop appears under the
   employee's **My devices**.

> **Tip:** In the demo, this whole set-up (the approval workflow, the form and the service catalog item) was made with
> the assistant as change set `CS-00001`. See [changing a process with the assistant](#scenario-changing-a-process-with-the-assistant).

## Scenario: a production release

The Finance ERP team is upgrading to version 12.1. The work is planned in a project, the version is tracked as a
release, production needs a CAB-approved change, and the pipeline records the deployment.

People involved: the project manager and team, the application owner or release manager, the change manager and the
CAB, the CI/CD pipeline.

1. In **Projects → Projects**, the **ERP upgrade to v12** project has the task **Change request for the production
   cutover**. See [Projects](projects.md).
2. In **Applications → Applications**, the release manager opens **Finance ERP**, then **Releases**, then **12.1.0
   (ERP v12 upgrade)**. **Readiness for production** lists the checks: **An authorized change is linked**,
   **Succeeded in test or staging**, **Release notes are written**, **No failed production deployment**.
3. The release needs a change. In the demo it already has one, the draft **Deploy Finance ERP 12.1.0 to production**;
   otherwise a change manager selects **Raise a change** on the release (release managers without the **Change
   manager** role don't see it), and the new change opens in **Service desk → Changes** with that title, already
   linked to the release. They complete the change plan (change type **Normal**, risk,
   planned window, implementation, backout and test plans) and select **Submit for approval**. See
   [Changes and releases](changes-and-releases.md).
4. The **Change authorization** workflow asks the **Change manager**, then the **Change Advisory Board** when the risk
   is high or a critical configuration item is involved. The change shows **Waiting for CAB**, then **Scheduled**.
5. The project manager links the change to the project task under **Linked records**, so the project shows where the
   cutover stands.
6. In the change window, the pipeline deploys and records the deployment in ISBP through the API (an API client with
   the **CI/CD pipeline** role). ISBP checks the change policy: production deployments need a change approved by the
   CAB, within its window. Without one, the deployment is refused unless someone allowed to override gives a reason,
   which is audited.
7. The release manager moves the release to **Released**. **Delivery metrics** on the application (deployment frequency, lead time,
   change failure rate, time to restore) include the deployment.

## Scenario: an ERP data feed

Finance wants sales figures in the data warehouse every four hours, and the reporting team wants ERP data as an API.
If a feed fails, its owners hear about it.

People involved: a database connection administrator, a data engineer, the job owner and owner group (in the demo,
the DBA team).

1. A database connection administrator registers the ERP database in **Administration → Database connections** (in
   the demo, **Contoso ERP (reporting)** and **Contoso data warehouse**), with encrypted credentials and the purpose
   **Data**. See [Data and automation](data-and-automation.md).
2. A data engineer publishes a Data API from SQL with parameters, in **Data APIs & ETL → Data APIs** (in the demo,
   **Customers by region**), tests it, and allows the API clients that may call it.
3. They build a pipeline in **Data APIs & ETL → Pipelines** that copies rows from the ERP to the warehouse (in the
   demo, **Daily sales to warehouse**).
4. A scheduled job runs the pipeline in **Scheduled jobs → Jobs** (in the demo, **Sales to warehouse (every 4
   hours)**), with retries and **Notify the owner and owner group when a run fails** switched on.
5. When a run fails after its last retry, the owners get a notification (**Runs of my jobs that fail**) and open the
   run's log in **Scheduled jobs → Runs**. In the demo, **CRM accounts to warehouse** fails because its MySQL server
   can't be reached. After repeated failures, a job is switched off until someone fixes it and enables it again.

## Scenario: database access for a developer

A developer needs to read the ERP reporting database for two weeks to investigate a bug. They get an account
without anyone sharing a password, and the access ends by itself.

People involved: the developer, their manager, the role owner, information security (for high-risk roles), the DBAs,
a reviewer.

1. The developer opens **Requests → Request database access**, chooses the role (in the demo, **ERP reporting
   (read-only)** on **Contoso ERP (PostgreSQL)**), the end date and the reason, and sends it. See
   [Request database access](employees.md#request-database-access).
2. **Manager approval**, then **Role owner approval**, and **Information security approval** for high-risk roles,
   decide in **Approvals**.
3. ISBP creates the account and grants the role on the database server automatically.
4. The developer gets **Your access is ready**, opens **Database access → My database access** and selects **Show
   the password**, once.
5. A few days before the end date, the developer is reminded (**Your access to … ends soon**) and can request an
   extension. On the end date the role is removed automatically.
6. Periodically, reviewers go through **Database access → Access reviews** and choose **Keep** or **Revoke** for each
   access. DBAs also see access granted outside ISBP (**Unmanaged access**) and can take it under management. See
   [Data and automation](data-and-automation.md).

## Scenario: working alongside ServiceDesk Plus and Azure DevOps Server

Some teams still work in ManageEngine ServiceDesk Plus and Azure DevOps Server (both on-premises). ISBP keeps records
in step in both directions, while its own rules (approvals, change policy) still apply.

People involved: an integration administrator, service desk agents, project teams.

1. An integration administrator connects each system in **Administration → Integrations** (in the demo, **Contoso
   ServiceDesk Plus** and **Contoso Azure DevOps Server**). See [Integrations](integrations.md).
2. Sync profiles say what syncs, in which direction and how fields map. In the demo: **Requests ↔ tickets**,
   **Problems → tickets**, **Changes → changes**, **Assets ↔ assets** and **Solutions → knowledge** with ServiceDesk
   Plus; **Team projects → projects**, **ERP work items ↔ tasks** and **Network work items → tasks** with Azure DevOps
   Server.
3. On a synced record, the **Synced with** card shows the remote record and when it last synced; **Sync now**
   refreshes it.
4. When the same field changed on both sides, a profile can ask a person to decide. The conflict waits in
   **Administration → Integrations → Sync conflicts**, where an administrator chooses **Keep ISBP's value**, **Keep the
   value from …** or **Keep both as they are**.
5. Changes made in the other system still follow ISBP's rules. In the demo, an asset disposed of in ServiceDesk Plus
   waits for ISBP's disposal approval.

## Scenario: changing a process with the assistant

The service desk wants to record the affected site on every ticket. The lead describes it to the assistant, an
administrator reviews it, and if it turns out wrong it can be undone in one step.

People involved: the service desk lead (in the demo, `helpdesk`), an administrator who reviews and applies.

1. The lead opens the **Assistant** in the header and asks for a select field "Affected site" on tickets with Taipei
   HQ, Hsinchu and Tokyo. Without an AI chat model, the **Custom field** guided template asks the same questions.
2. The assistant prepares a change set: what will change, a readable diff and a **Dry run** that tries the whole set
   without saving it. Nothing is live yet.
3. The lead isn't allowed to change custom fields (they have the **Configuration viewer** role, which can only
   propose), so they select **Request review**. In
   the demo, this is `CS-00002`, waiting in the administrator's **Approvals**.
4. The administrator reviews the change set in **Approvals** (**Change set review**) and approves. Approving applies
   it, with the approver's permissions, in one transaction.
5. If it's wrong, someone with the permissions opens **Administration → Change sets**, opens the change set and
   selects **Roll back**. If someone has changed the same configuration since, ISBP refuses and asks them to refresh
   and review the differences first.

See [Assistant and AI](assistant-and-ai.md).

## How it connects

- Start here: [Start here](README.md).
- The role guides: [Employees](employees.md), [Service desk](service-desk.md),
  [Changes and releases](changes-and-releases.md), [Assets](assets.md), [Projects](projects.md),
  [Data and automation](data-and-automation.md), [Integrations](integrations.md),
  [Assistant and AI](assistant-and-ai.md), [Administrators](administrators.md).
- Terms: [Glossary](glossary.md). Problems: [FAQ](faq.md).
