# Changes and releases guide

This guide is for change managers, members of the Change Advisory Board (CAB) and application owners. It explains
how a change is raised, planned, approved and implemented, and how the Applications area tracks what runs where,
which releases are ready, and every deployment — with the rule that nothing reaches production without an
approved change.

## What you can do here

- [Choose the change type](#choose-the-change-type) and see who approves each kind
- [Raise a change](#raise-a-change) and [plan its window around other changes](#plan-the-window-around-other-changes)
- [Get CAB approval](#get-cab-approval), or [decide on a change as an approver](#decide-on-a-change-as-an-approver)
- [Implement and review a change](#implement-and-review-a-change)
- [Handle changes that come from ServiceDesk Plus](#handle-changes-that-come-from-servicedesk-plus) and
  [changes raised by a request form](#handle-changes-raised-by-a-request-form)
- [Keep your application's record up to date](#keep-your-applications-record-up-to-date), including its Git status
- [Plan a release and check its readiness](#plan-a-release-and-check-its-readiness)
- [Record a deployment](#record-a-deployment), by hand or [from a CI/CD pipeline](#record-deployments-from-a-cicd-pipeline)
- [Override the change policy in an emergency](#override-the-change-policy-in-an-emergency)
- [Read the delivery metrics](#read-the-delivery-metrics)

## Choose the change type

Every change has a type and a risk. Together with the configuration items (CIs) it touches, they decide the
approval path. The path is the **Change authorization** approval workflow, which can't be switched off; an
administrator can adjust its steps in **Administration → Workflows**.

| Type          | Use it for                                                 | Who approves (default workflow)                                                                                   |
| ------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Standard**  | Pre-approved, low-risk, repeatable work (monthly patching) | Nobody: it is scheduled as soon as you submit it                                                                  |
| **Normal**    | Planned changes                                            | The change manager (within 24 h); then the CAB (within 72 h) when the risk is high or a critical CI is involved   |
| **Emergency** | An urgent fix that can't wait for the next CAB             | The emergency CAB: any one member of the Change Advisory Board, within 4 h, escalated to the change manager after |

The approver lists come from the **Change manager** role and the **Change Advisory Board** group.

## Raise a change

Raise a change for anything that alters production: an upgrade, a configuration change, a deployment. You need
the **Change manager** role; in the demo, `admin` has it.

1. Go to **Service desk → Changes** and select **New change**. The form opens at the side.
2. Under **What and when**, fill in **What will change?**.
3. Pick the **Configuration items** the change touches. They are used for conflict checks, impact and CAB rules
   (critical CIs need the CAB).
4. Set the **Planned window** (**Start** and **End**), and choose the **Change type** and the **Risk**.
5. Check the conflict message, and the **Requester (accepts the change)**: you by default. The requester accepts
   the change after implementation, and their department decides who approves it.
6. Under **Reason and plans**, write the **Details**, the **Reason for the change**, the **Implementation plan**,
   the **Backout plan** and the **Test plan** (you can also add them later, before the CAB looks at it).
7. Select **Create and submit for approval** to send it to the CAB straight away, or **Save draft** to finish the
   plan first.

**What happens next:** the change opens. Submitted, it is **Waiting for CAB** ("CHG-… created and submitted for
approval"); saved, it is a **Draft** ("CHG-… created as a draft"). Submitting needs a planned window that hasn't
started yet (except for emergency changes); the form says so before anything is created. Until it is submitted,
you can change the plan with **Edit** on the **Change plan** card or **More actions → Edit plan**.

> **Tip:** From a release in Applications, **Raise a change** opens this form for change managers, with the title
> "Deploy (application) (version) to production" filled in and the release already linked. A request form can also
> raise changes for you: see [Handle changes raised by a request form](#handle-changes-raised-by-a-request-form).

## Plan the window around other changes

Two changes on the same CI at the same time make failures hard to trace. ISBP flags them as you plan.

1. While you create or edit a change, the form says either "No other changes touch these CIs in this window" or
   how many other changes do, with the CIs they share.
2. On the change page, the **Change plan** card lists the overlapping changes with their status.
3. To see the whole picture, go to **Service desk → Changes** and choose a view: **Month**, **Agenda** or
   **List**. The month and the agenda show each change with its start time, marked by where it stands (**Not
   submitted** with a dashed outline, **Waiting for CAB** with a clock, **Approved and planned**, **Done** with a
   check), emergencies with a lightning icon and overlapping changes as **Conflict**; use **Previous month**,
   **Next month** and **Today** to move. A change that was never submitted and whose start has passed shows
   **Window has passed**. **List** shows every change with its type, risk, **Planned window**, status and owner. The
   month view loads every change of the month, up to 2,000; if there are more, it says so, and you can read the rest
   in the agenda. The agenda loads a page at a time: select **Show more** at the end of the list for the next page.

Only changes in **Assessment**, **Waiting for CAB**, **Scheduled** or **Implementing** count as conflicts; drafts
don't.

In the demo, the ERP database index rebuild and the ERP application server patching share Finance ERP on the same
Saturday evening, so both are flagged.

![The change calendar with conflicts flagged](../../../apps/web/public/help/en/changes-calendar.jpg)

## Get CAB approval

When the plan is ready, send the change through the approval workflow.

1. Open the change and select **Submit for approval** (the main button of a draft).
2. If the change has no planned window yet, or its window has already started, **Plan the window to submit**
   opens: set **Start** and **End** and select **Save and submit for approval**.

A change can't be submitted without a planned window, and the window may not start in the past (except for
emergency changes). If submitting fails for another reason, the message says what to fix, with **Edit plan**.

**What happens next:**

- The status becomes **Waiting for CAB**. The **CAB approval** section of the **Change plan** card shows each
  step of the path the change takes: who it is waiting for and by when, who approved or rejected it, and steps
  that were skipped and why. When everyone of a fallback group is asked, it says so: the first answer decides.
  **Show the whole flow** shows the workflow as a diagram.
- The approvers are notified and decide in **Approvals**.
- **Approved:** the change moves to **Scheduled**, and the requester, the assignee and whoever raised it are
  notified with the planned start.
- **Rejected:** the change moves to **Rejected** with the approver's comment. Select **Revise and resubmit** (it
  goes back to **Draft**), improve the plan and submit it again.
- To stop a change that is waiting, choose **Cancelled** in **Other status** (with a reason); the approval is
  withdrawn.

> **Important:** Nobody can move a change past **Waiting for CAB** by hand — not in **Other status**, not
> through the API and not through an integration. Only the approval does it. Once submitted, the plan can't be
> edited.

In the demo, CHG-00002 "Renew TLS certificate on mail-relay-01" waits for the change manager and then the CAB,
because it touches Email & Calendar, a critical CI. CHG-00001, a standard patching change, was scheduled as soon
as it was submitted.

![A change waiting for CAB approval, with the approval path](../../../apps/web/public/help/en/changes-cab-approval.jpg)

## Decide on a change as an approver

As the change manager or a CAB member, you get a notification for every change waiting for you.

1. Open the notification, or the change from **My work** (**To decide**).
2. On the change, **Your approval is needed** sits under the title, with the deadline. Check the plan, the window,
   the affected CIs and any conflicts below it.
3. Select **Approve** (with an optional comment) or **Reject** (a reason is required; the requester sees it), and
   confirm. If the step asks you to fill in fields, **Open the approval** takes you to your approvals instead. To
   pass it to a colleague, use **Hand over** in your approvals.

For a group step, the first answer decides. Reminders and escalations follow the deadlines in
[Choose the change type](#choose-the-change-type). More on the approvals inbox: [Employees](employees.md).

## Implement and review a change

1. When the window opens, select **Start implementation**. If nobody owns the change yet, it is assigned to you.
2. Keep a record of the work as **Work note**s on the change, and record the deployment in Applications if the
   change deploys an application version (see [Record a deployment](#record-a-deployment)).
3. When the work is done, select **Finish implementation**: the change moves to **Post-implementation review**.
   Note what went as planned and what didn't. The change's requester is asked to check it: on the change they
   select **Accept the change**, or **Report a problem** and say what is wrong — it is right under the title for
   them. The **Requester acceptance** card shows their answer, and you are notified.
4. Select **Close change**. The timeline records whether the requester accepted the change. If an administrator
   turned on **Require the requester's acceptance before closing a change**, a change with a requester can only be
   closed once they have accepted it; until then the button says **Waiting for the requester to accept**.

A scheduled change can still be cancelled (with a code and a reason). Once it is **Implementing**, it can only go
on to review.

On a change, the **Releases & deployments** card on the right lists the releases linked to it and the deployments
it authorized. In the demo, CHG-00007 "Upgrade Wi-Fi controller wlc-01 to 8.10" is in post-implementation
review.

## Handle changes that come from ServiceDesk Plus

If your organisation also plans changes in on-premises ManageEngine ServiceDesk Plus, the Integrations Hub can
bring them into ISBP (in the demo, the **Changes → changes** sync rule of Contoso ServiceDesk Plus). They show the
**Synced with** card and follow the same lifecycle.

The sync can fill in a change and submit it, but it can't approve it: a change from outside stops at **Waiting
for CAB** until the CAB approves it in ISBP, exactly like one raised here. See
[Integrations](integrations.md).

## Handle changes raised by a request form

Some request forms raise the change themselves once the request is approved, so people who aren't change managers
can ask for a change in the portal. In the demo, the **Configuration change request** does this: the requester picks
the CIs and describes the change, their manager and the CIs' support group approve the request, and the form's
**Raise a change** action creates the change.

- The change shows **From request REQ-… · Configuration change request** at the top; it opens the request with its
  answers and approvals. The person who sent the request is the change's requester, and its channel is **Request
  form**.
- It is linked to the CIs picked on the form, so the conflict check and the CAB routing work as for any change, and
  the CIs list it.
- When the form submits it, the change arrives in **Waiting for CAB** and goes through **Change authorization**
  exactly like a change you submit: the change manager, and the CAB when the risk is high or a critical CI is
  involved (the emergency CAB for an emergency change). The request's own approval never replaces it, and a form
  can't raise a pre-approved standard change from a requester's answer.
- A change the form didn't submit waits in **Draft**; one whose planned window had already started when the request
  was approved waits in **Assessment**. Check the plan, adjust the window with **Edit** and select **Submit for
  approval** yourself.

The form's planned dates have no time of day, so the window starts and ends at midnight UTC (08:00 in Taipei) on
those days. In the demo, the approved request "Raise the department share quota on fs-01" raised such a change; it is
waiting for the change manager. How such a form is built: [Build your own process](processes.md#add-actions).

## Keep your application's record up to date

**Applications** is the inventory of every application the company runs: who owns it, where it is in its
lifecycle, what version runs in each environment and how delivery is going.

- **Applications viewer** (the service desk, network, security, DBA, CAB and application owners groups in the
  demo) can browse everything.
- The **business owner**, the **technical owner** and members of the **Delivery team** edit their own
  application and its releases with that role alone.
- **Applications manager** edits any application; **Release manager** plans releases of any application.

1. Go to **Applications**. Above the list are the number of applications, **Deployments, last 7 days** and
   **Releases in the next 14 days** (select it for the release calendar). Use the tabs (**All**, **In production**,
   **In development**, **Sunsetting & retired**, **Owned by me**, each with its count), the search box (code or
   name) and the filters.
2. Open an application. The header shows its stage, criticality, the version **in production** and its owners.
   **Overview** shows the **Environments** with the version each one **Runs**, the **Delivery metrics**, the
   **Description**, the **Repositories**, **Ownership**, the **CMDB** configuration item and **Details**.
3. Select **Edit** to change the name, stage, criticality, hosting, owners, **Delivery team** and **Support group**.
   The **Investment decision** (**Keep as is**, **Invest**, **Replace or move** or **Retire**), the configuration
   item and the other details are under **Details**. The **Code** can't change: CI/CD pipelines use it.
4. Use the **Settings** tab to maintain **Environments** (in pipeline order; production environments are
   protected by the change policy), **Repositories** and the **Lifecycle** (stage, investment decision and dates).

**Git status.** Repositories on our on-premises Azure DevOps Server are kept up to date by the Integrations Hub:
each one shows its default branch, last commit, branches (**Show branches**), active pull requests and when it was
**Synced**. In the demo, Finance ERP has the `erp-core` and `erp-reports` repositories.

![The Finance ERP application with its environments and delivery metrics](../../../apps/web/public/help/en/changes-application.jpg)

## Plan a release and check its readiness

A release is a version of an application on its way to production. Its readiness checklist tells you, and the
CAB, whether it can go.

1. On the application, select **New release**. Enter the **Version** (unique within the application, for example
   `12.1.0`) and the **Planned date**; a **Name** and the **Release notes** (Markdown) are under **More details**.
   Save.
2. On the release page, follow its lifecycle (**Planned**, **In progress**, **Ready**, **Released**) under the
   header; move it with **Move to …** under **More actions**.
3. Check **Readiness for production**: how many checks pass, and under each check that doesn't pass yet, what is
   missing and a button for the next step. It passes when:
   - **An authorized change is linked** (approved by the CAB and scheduled, or implementing). Select **Raise a
     change** (change managers) to open a new change already linked to the release, with its window on the evening
     of the planned date (20:00–21:00, which you can change), or **Open CHG-…** to submit or follow the linked one.
     You can also link an existing change under **Linked records** with **Link record**;
   - the version **Succeeded in test or staging**: **Record a test deployment** opens **Record deployment** for a
     test environment;
   - **Release notes are written**: **Write release notes** opens the release for editing;
   - there was **No failed production deployment** of this version.

   Under **Before production**, the card also says what production will need from the change policy.

**What happens next:** linking a change moves a planned release to **In progress**. When every check passes, the
owners are notified that the release is ready for production; the notification opens **Record deployment** for
production. A successful production deployment of the version marks the release **Released**.

The **Release calendar** tab of **Applications** shows the releases of every application in the coming weeks (**By
week** or **Month**), with their change status (**No change linked** when there is none) and readiness; weeks with
nothing planned are folded together. **Only my applications** narrows it to yours.

In the demo, Finance ERP 12.1.0 "ERP v12 upgrade" has reached Staging, but its change (CHG-00011) is still a
draft, so one check fails. HR Portal 3.4.0 is ready: its change CHG-00009 is scheduled.

![The readiness checklist of release 12.1.0](../../../apps/web/public/help/en/changes-release-readiness.jpg)

## Record a deployment

Record every deployment, so everyone can see what runs where and the delivery metrics stay true. You need
permission to record deployments (the **Release manager** or **Applications manager** role).

1. On the application or the release, select **Record deployment**.
2. Choose the **Environment**, check the **Version**, and choose the **Outcome** (**Succeeded**, **Failed**, **In
   progress** or **Rolled back**).
3. For production, choose the **Change**: the one linked to the release (**CHG-… (linked to the release)**), **No
   change**, or **Another change…** to enter its **Change reference**.
4. Read **Change policy**: it says whether the deployment is allowed now, and why not if it isn't. When no change
   is authorized, **Raise a change** opens a new change for the release.
5. Optionally add **Notes**, and under **Commit and pipeline** the **Commit** and the **Pipeline run** link.
6. Select **Record deployment**. If the change policy refuses the deployment, the form says so under the button
   and points to the policy above (or to **Override with reason**, if you may override it).

**The change policy.** A deployment to a production environment needs a change that is **Scheduled** or
**Implementing**, named in the form or linked to the release. Other environments need no change. Outside the
change's planned window the deployment is recorded with a warning (**Outside change window**), or refused if an
administrator has turned on **Enforce the change window**. Both settings are in **Administration → Modules**
(Applications).

**What happens next:** the environment shows the new version. A failure or rollback notifies the technical owner
and the delivery team. The **Deployments** tab keeps the full history.

## Record deployments from a CI/CD pipeline

Pipelines report deployments themselves through the API, so the record is complete without anyone typing it in.

- An administrator creates an API client with the **CI/CD pipeline** role in **Administration → API clients**
  and gives its key to the pipeline.
- The pipeline sends the application **Code**, the environment, the version, the outcome and, for production, the
  change number.
- The same change policy applies. Without an approved change, the API refuses the deployment, so the pipeline step
  fails and says why. A pipeline can't override the policy.

The request format: [API guide](../../api.md#recording-deployments-from-cicd-application-lifecycle).

## Override the change policy in an emergency

Sometimes production must be fixed before a change can be approved. Only people with the **Applications
administrator** role can record such a deployment.

1. In **Record deployment**, when the policy refuses the deployment, select **Override with reason** (under
   **Change policy**).
2. Explain **Why must this deploy without an authorized change?** (at least 10 characters).
3. Select **Record with override**.

**What happens next:** the override is audited as a security event, the change managers are notified ("Change
policy overridden: …"), and the deployment is marked **Policy overridden** in the history. Raise the emergency
change afterwards so the CAB can review it.

> **Important:** Use an emergency change first whenever the emergency CAB can be reached; it decides within
> hours.

## Read the delivery metrics

The **Delivery metrics** card on an application's **Overview** shows the four DORA measures for production over
the last 90 days, computed from the recorded deployments:

| Measure                   | What it means                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------- |
| **Deployment frequency**  | Successful production deployments per week                                              |
| **Change failure rate**   | The share of finished production deployments that failed or were rolled back            |
| **Lead time for changes** | Median time from a release being created to its first successful production deployment  |
| **Time to restore**       | Median time from a failed production deployment to the next success on that environment |

Switch between **Chart** and **Table** to see the weekly figures. Use them in CAB reviews and retrospectives; they
are only as good as the deployment records, which is one more reason to record deployments from the pipeline.

## How it connects

- **Incidents and problems** that a change fixes are linked with **Implements fix for**:
  [Service desk](service-desk.md).
- **Configuration items** decide conflicts and the CAB step: [Service desk](service-desk.md#check-what-a-configuration-item-affects).
- **Request forms** that raise changes, and approvals that route on the picked CIs:
  [Build your own process](processes.md).
- **Projects** link their tasks to changes and releases: [Projects](projects.md).
- **ServiceDesk Plus** changes and **Azure DevOps Server** repositories sync through the hub:
  [Integrations](integrations.md).
- **Approval workflows**, module settings and API clients are set up by administrators:
  [Administrators](administrators.md).
- Terms such as CAB, standard change and DORA: [Glossary](glossary.md).
